import * as vscode from "vscode";
import type { ConceptMastery, FileKnowledge, ProfileFacts, RecallCard } from "../types";

const SESSION_KEY = "comprehensionGuard.supabaseSession";
const QUEUE_KEY = "comprehensionGuard.syncQueue";

type Session = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  expiresAt: number;
};

type SyncOp =
  | { table: "concept_mastery"; row: Record<string, unknown> }
  | { table: "recall_cards"; row: Record<string, unknown> }
  | { table: "profiles"; row: Record<string, unknown> }
  | { table: "file_knowledge"; row: Record<string, unknown> }
  | { table: "review_events"; row: Record<string, unknown>; insert: true }
  | { table: "prep_sets"; row: Record<string, unknown>; insert: true };

function supabaseUrl(): string {
  return vscode.workspace.getConfiguration("comprehensionGuard").get<string>("supabaseUrl", "").trim();
}

function supabaseAnonKey(): string {
  return vscode.workspace.getConfiguration("comprehensionGuard").get<string>("supabaseAnonKey", "").trim();
}

export function syncConfigured(): boolean {
  return supabaseUrl().length > 0 && supabaseAnonKey().length > 0;
}

async function readSession(context: vscode.ExtensionContext): Promise<Session | undefined> {
  const raw = await context.secrets.get(SESSION_KEY);
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return undefined;
  }
}

async function writeSession(context: vscode.ExtensionContext, session: Session): Promise<void> {
  await context.secrets.store(SESSION_KEY, JSON.stringify(session));
}

export async function signOut(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(SESSION_KEY);
}

export async function signIn(
  context: vscode.ExtensionContext,
  email: string,
  password: string,
): Promise<string> {
  const url = supabaseUrl();
  const anon = supabaseAnonKey();
  if (!url || !anon) {
    throw new Error("Set comprehensionGuard.supabaseUrl and comprehensionGuard.supabaseAnonKey first.");
  }
  const response = await fetch(url.replace(/\/$/, "") + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    user?: { id?: string };
    expires_in?: number;
    error_description?: string;
    msg?: string;
  };
  if (!response.ok || !body.access_token || !body.user?.id) {
    throw new Error(body.error_description || body.msg || "Sign-in failed (" + response.status + ").");
  }
  await writeSession(context, {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? "",
    userId: body.user.id,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  });
  await flushSync(context);
  return body.user.id;
}

async function authHeader(context: vscode.ExtensionContext): Promise<{ anon: string; token: string; userId: string } | undefined> {
  if (!syncConfigured()) {
    return undefined;
  }
  let session = await readSession(context);
  if (!session) {
    return undefined;
  }
  if (session.expiresAt <= Date.now() + 30_000) {
    const refreshed = await refreshSession(context);
    if (refreshed) {
      session = {
        accessToken: refreshed.token,
        refreshToken: session.refreshToken,
        userId: refreshed.userId,
        expiresAt: Date.now() + 3600_000,
      };
    }
  }
  return { anon: supabaseAnonKey(), token: session.accessToken, userId: session.userId };
}

async function refreshSession(
  context: vscode.ExtensionContext,
): Promise<{ anon: string; token: string; userId: string } | undefined> {
  const session = await readSession(context);
  if (!session?.refreshToken || !syncConfigured()) {
    return undefined;
  }
  try {
    const response = await fetch(supabaseUrl().replace(/\/$/, "") + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: supabaseAnonKey(), "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
    const body = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!response.ok || !body.access_token) {
      return undefined;
    }
    await writeSession(context, {
      accessToken: body.access_token,
      refreshToken: body.refresh_token || session.refreshToken,
      userId: session.userId,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    });
    return { anon: supabaseAnonKey(), token: body.access_token, userId: session.userId };
  } catch {
    return undefined;
  }
}

const QUEUE_CAP = 5000;
let chain: Promise<void> = Promise.resolve();
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function enqueue(context: vscode.ExtensionContext, op: SyncOp): SyncOp[] {
  const prev = context.globalState.get<SyncOp[]>(QUEUE_KEY, []);
  const next = [...(Array.isArray(prev) ? prev : []), op].slice(-QUEUE_CAP);
  void context.globalState.update(QUEUE_KEY, next);
  return next;
}

export function flushSync(context: vscode.ExtensionContext): Promise<void> {
  const run = chain.then(() => doFlush(context));
  chain = run.then(() => undefined, () => undefined);
  return run;
}

/** Drops a retry left over from an earlier test so the next case starts clean. */
export function resetSyncForTests(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
  }
  retryTimer = undefined;
  chain = Promise.resolve();
}

async function doFlush(context: vscode.ExtensionContext): Promise<void> {
  let auth = await authHeader(context);
  const queued = context.globalState.get<SyncOp[]>(QUEUE_KEY, []);
  if (!auth || !Array.isArray(queued) || queued.length === 0) {
    return;
  }
  const remaining: SyncOp[] = [];
  for (const op of queued) {
    let ok = await upsert(auth, op);
    if (!ok) {
      const refreshed = await refreshSession(context);
      if (refreshed) {
        auth = refreshed;
        ok = await upsert(auth, op);
      }
    }
    if (!ok) {
      remaining.push(op);
    }
  }
  const latest = context.globalState.get<SyncOp[]>(QUEUE_KEY, []);
  const added = Array.isArray(latest) ? latest.slice(queued.length) : [];
  await context.globalState.update(QUEUE_KEY, [...remaining, ...added].slice(-QUEUE_CAP));
  if (remaining.length > 0) {
    if (retryTimer) {
      clearTimeout(retryTimer);
    }
    retryTimer = setTimeout(() => {
      void flushSync(context);
    }, 1000);
    retryTimer.unref?.();
  }
}

async function upsert(
  auth: { anon: string; token: string; userId: string },
  op: SyncOp,
): Promise<boolean> {
  const insertOnly = "insert" in op && op.insert;
  const conflict = op.table === "profiles" ? "user_id" : "user_id,concept";
  const onConflict = op.table === "file_knowledge" ? "user_id,path" : conflict;
  const url = supabaseUrl().replace(/\/$/, "") + "/rest/v1/" + op.table + (insertOnly ? "" : "?on_conflict=" + onConflict);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        apikey: auth.anon,
        Authorization: "Bearer " + auth.token,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ ...op.row, user_id: auth.userId }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function queueMastery(context: vscode.ExtensionContext, row: ConceptMastery): void {
  enqueue(context, {
    table: "concept_mastery",
    row: {
      concept: row.concept,
      mastery: row.mastery,
      elo: row.elo,
      attempts: row.attempts,
      last_seen: new Date(row.lastSeen).toISOString(),
    },
  });
  void flushSync(context);
}

export function queueCard(context: vscode.ExtensionContext, row: RecallCard): void {
  enqueue(context, {
    table: "recall_cards",
    row: {
      concept: row.concept,
      ease: row.ease,
      interval_days: row.intervalDays,
      repetitions: row.repetitions,
      due_at: new Date(row.dueAt).toISOString(),
      stability: row.stability,
      difficulty: row.difficulty,
      last_review: row.lastReview ? new Date(row.lastReview).toISOString() : null,
    },
  });
  void flushSync(context);
}

export function queueProfile(context: vscode.ExtensionContext, row: ProfileFacts): void {
  enqueue(context, {
    table: "profiles",
    row: {
      exam_date: row.examDate || null,
      interview_date: row.interviewDate || null,
      preferred_language: row.preferredLanguage || null,
      strictness: row.strictness || null,
      updated_at: new Date().toISOString(),
    },
  });
  void flushSync(context);
}

export function queueFileKnowledge(context: vscode.ExtensionContext, row: FileKnowledge): void {
  enqueue(context, {
    table: "file_knowledge",
    row: {
      path: row.path,
      concepts: row.concepts,
      passed: row.passed,
      ai_written: row.aiWritten,
      core: row.core ?? false,
      complexity: row.complexity ?? null,
      centrality: row.centrality ?? null,
      updated_at: new Date(row.updatedAt).toISOString(),
    },
  });
  void flushSync(context);
}

export function queueReview(context: vscode.ExtensionContext, event: {
  concepts: string[];
  eventKind: string;
  source?: string;
  mode?: string;
  score?: number;
  passed?: boolean;
  followups: number;
  masteryAfter?: number;
  filePath?: string;
  question?: string;
  studentAnswer?: string;
  misconception?: string;
  askedForExplanation: boolean;
  explanation?: string;
  judgeConfigId?: string;
}): void {
  enqueue(context, {
    table: "review_events",
    insert: true,
    row: {
      concepts: event.concepts,
      event_kind: event.eventKind,
      source: event.source ?? null,
      mode: event.mode ?? null,
      score: event.score ?? null,
      passed: event.passed ?? null,
      followups: event.followups,
      mastery_after: event.masteryAfter ?? null,
      file_path: event.filePath ?? null,
      question: event.question ?? null,
      student_answer: event.studentAnswer ?? null,
      misconception: event.misconception || null,
      asked_for_explanation: event.askedForExplanation,
      explanation: event.explanation || null,
      judge_config_id: event.judgeConfigId ?? null,
    },
  });
  void flushSync(context);
}

export function queuePrepSet(
  context: vscode.ExtensionContext,
  kind: "interview" | "exam",
  project: string,
  questions: unknown[],
): void {
  enqueue(context, {
    table: "prep_sets",
    insert: true,
    row: {
      kind,
      project,
      questions,
      created_at: new Date().toISOString(),
    },
  });
  void flushSync(context);
}
