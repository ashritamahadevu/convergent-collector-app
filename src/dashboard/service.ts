import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DashboardOutbox } from "./outbox";
import {
  isRelativePath,
  localEndpoint,
  type CheckOutcome,
  type CheckShape,
  type DashboardEvent,
  type FileEdgesEvent,
  type FileEvent,
  type MasteryEvent,
  type PrepQuestion,
  type PrepSetEvent,
  type ProfileEvent,
  type RecallEvent,
  type ReviewEvent,
} from "./protocol";

const SECRET = "comprehensionGuard.desktopToken";
const ENDPOINT = "comprehensionGuard.desktopEndpoint";
const LAST_SYNC = "comprehensionGuard.desktopLastSyncedAt";
const services = new WeakMap<vscode.ExtensionContext, DashboardOutbox>();
const enabled = () => vscode.workspace.getConfiguration("comprehensionGuard").get<boolean>("desktopSyncEnabled", false);

function outbox(context: vscode.ExtensionContext): DashboardOutbox {
  let result = services.get(context);
  if (!result) {
    result = new DashboardOutbox(path.join(context.globalStorageUri.fsPath, "dashboard-outbox"));
    services.set(context, result);
  }
  return result;
}
async function connection(context: vscode.ExtensionContext) {
  if (!enabled() || vscode.env.remoteName) return null;
  const token = await context.secrets.get(SECRET);
  const endpoint = context.globalState.get<string>(ENDPOINT);
  return token && endpoint ? { token, endpoint } : null;
}
async function flush(context: vscode.ExtensionContext): Promise<void> {
  const box = outbox(context);
  await box.flush(() => connection(context));
  if (box.lastSyncedAt !== null) await context.globalState.update(LAST_SYNC, box.lastSyncedAt);
}

function installationId(context: vscode.ExtensionContext): string {
  return createHash("sha256").update(context.globalStorageUri.toString()).digest("hex");
}

function projectOf(filePath?: string): { id: string; name: string; relative: string | null } {
  const file = filePath ? vscode.Uri.file(filePath) : undefined;
  const folder = file ? vscode.workspace.getWorkspaceFolder?.(file) : vscode.workspace.workspaceFolders?.[0];
  const projectKey = folder?.uri.toString() ?? "unassigned";
  const relative = folder && filePath
    ? path.relative(folder.uri.fsPath, filePath).replace(/\\/g, "/")
    : filePath?.replace(/\\/g, "/") ?? null;
  const safe = relative && isRelativePath(relative) ? relative : null;
  return {
    id: createHash("sha256").update(projectKey).digest("hex"),
    name: folder?.name ?? "Unassigned",
    relative: safe,
  };
}

/** Save locally before returning; network delivery is background work. */
async function enqueueDashboard(context: vscode.ExtensionContext, event: DashboardEvent): Promise<void> {
  if (!enabled() || vscode.env.remoteName) return;
  try {
    const box = outbox(context);
    await box.enqueue(event);
    void flush(context).catch(() => {});
  } catch (e) {
    void vscode.window.showWarningMessage("Dashboard sync could not save this update: " + (e instanceof Error ? e.message : "storage error"));
  }
}

export async function recordReview(
  context: vscode.ExtensionContext,
  input: {
    eventId: string;
    timestamp: number;
    concepts: string[];
    topic?: string;
    question: string;
    answer: string;
    feedback: string;
    misconception: string;
    outcome: CheckOutcome;
    score: number | null;
    source: string;
    mode: string;
    shape?: CheckShape;
    groupId?: string;
    filePath?: string;
    retries: number;
    masteryAfter?: number;
  },
): Promise<void> {
  const project = projectOf(input.filePath);
  const event: ReviewEvent = {
    schemaVersion: 1,
    type: "review.recorded",
    eventId: input.eventId,
    installationId: installationId(context),
    occurredAt: input.timestamp,
    project: { id: project.id, name: project.name },
    concepts: input.concepts,
    topic: input.topic ?? "",
    question: input.question,
    answer: input.answer,
    feedback: input.feedback,
    misconception: input.misconception,
    outcome: input.outcome,
    score: input.score,
    source: input.source,
    mode: input.mode,
    shape: input.shape ?? "general",
    groupId: input.groupId ?? input.eventId,
    filePath: project.relative,
    retries: input.retries,
    masteryAfter: input.masteryAfter ?? null,
  };
  await enqueueDashboard(context, event);
}

export async function recordMastery(
  context: vscode.ExtensionContext,
  row: { concept: string; mastery: number; elo: number; attempts: number; lastSeen: number },
): Promise<void> {
  const event: MasteryEvent = {
    schemaVersion: 1,
    type: "mastery.updated",
    eventId: "mastery-" + createHash("sha256").update(row.concept).digest("hex").slice(0, 24),
    installationId: installationId(context),
    occurredAt: row.lastSeen,
    concept: row.concept,
    mastery: row.mastery,
    elo: row.elo,
    attempts: row.attempts,
    lastSeen: row.lastSeen,
  };
  await enqueueDashboard(context, event);
}

export async function recordRecallCard(
  context: vscode.ExtensionContext,
  row: {
    concept: string;
    ease: number;
    intervalDays: number;
    repetitions: number;
    dueAt: number;
    stability: number;
    difficulty: number;
    lastReview: number;
  },
): Promise<void> {
  const event: RecallEvent = {
    schemaVersion: 1,
    type: "recall.updated",
    eventId: "recall-" + createHash("sha256").update(row.concept).digest("hex").slice(0, 24),
    installationId: installationId(context),
    occurredAt: row.lastReview || row.dueAt,
    ...row,
  };
  await enqueueDashboard(context, event);
}

export async function recordFile(
  context: vscode.ExtensionContext,
  row: {
    path: string;
    concepts: string[];
    topic?: string;
    passed: boolean;
    aiWritten: boolean;
    core?: boolean;
    complexity?: number;
    centrality?: number;
    updatedAt: number;
  },
): Promise<void> {
  const relative = projectOf(row.path).relative;
  if (!relative) return;
  const event: FileEvent = {
    schemaVersion: 1,
    type: "file.updated",
    eventId: "file-" + createHash("sha256").update(relative).digest("hex").slice(0, 24),
    installationId: installationId(context),
    occurredAt: row.updatedAt,
    path: relative,
    concepts: row.concepts,
    topic: row.topic ?? "",
    passed: row.passed,
    aiWritten: row.aiWritten,
    core: row.core ?? false,
    complexity: row.complexity ?? null,
    centrality: row.centrality ?? null,
    updatedAt: row.updatedAt,
  };
  await enqueueDashboard(context, event);
}

export async function recordFileEdges(
  context: vscode.ExtensionContext,
  fromPath: string,
  edges: { toPath: string; kind: "call" | "import" }[],
): Promise<void> {
  const from = projectOf(fromPath).relative;
  if (!from) return;
  const mapped = edges
    .map((edge) => ({ toPath: projectOf(edge.toPath).relative, kind: edge.kind }))
    .filter((edge): edge is { toPath: string; kind: "call" | "import" } => !!edge.toPath && edge.toPath !== from);
  const event: FileEdgesEvent = {
    schemaVersion: 1,
    type: "file.edges",
    eventId: "edges-" + createHash("sha256").update(from).digest("hex").slice(0, 24),
    installationId: installationId(context),
    occurredAt: Date.now(),
    fromPath: from,
    edges: mapped,
  };
  await enqueueDashboard(context, event);
}

export async function recordProfile(
  context: vscode.ExtensionContext,
  row: { examDate?: string; interviewDate?: string; preferredLanguage?: string; strictness?: string },
): Promise<void> {
  const event: ProfileEvent = {
    schemaVersion: 1,
    type: "profile.updated",
    eventId: "profile",
    installationId: installationId(context),
    occurredAt: Date.now(),
    examDate: row.examDate,
    interviewDate: row.interviewDate,
    preferredLanguage: row.preferredLanguage,
    strictness: row.strictness,
  };
  await enqueueDashboard(context, event);
}

export async function recordPrepSet(
  context: vscode.ExtensionContext,
  kind: "interview" | "exam",
  project: string,
  questions: PrepQuestion[],
): Promise<void> {
  const safe = questions
    .map((item) => ({ ...item, path: projectOf(item.path).relative ?? "" }))
    .filter((item) => isRelativePath(item.path));
  if (safe.length === 0) return;
  const event: PrepSetEvent = {
    schemaVersion: 1,
    type: "prepset.created",
    eventId: randomUUID(),
    installationId: installationId(context),
    occurredAt: Date.now(),
    kind,
    project,
    questions: safe,
  };
  await enqueueDashboard(context, event);
}

export function registerDashboardSync(context: vscode.ExtensionContext): void {
  const retry = () => { if (enabled()) void flush(context).catch(() => {}); };
  const timer = setInterval(retry, 15000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration("comprehensionGuard.desktopSyncEnabled")) retry();
  }));
  context.subscriptions.push(vscode.commands.registerCommand("comprehensionGuard.connectDesktop", async () => {
    if (vscode.env.remoteName) { void vscode.window.showWarningMessage("Desktop sync currently supports local VS Code windows only."); return; }
    const selected = await vscode.window.showOpenDialog({ canSelectMany: false, title: "Select the desktop backend's pairing-token file" });
    if (!selected?.[0]) return;
    const endpoint = await vscode.window.showInputBox({ prompt: "Desktop backend address", value: "http://127.0.0.1:43821" });
    if (!endpoint) return;
    try {
      const token = (await fs.readFile(selected[0].fsPath, "utf8")).trim();
      if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Select the pairing-token file created by the desktop backend.");
      const address = localEndpoint(endpoint);
      await context.secrets.store(SECRET, token);
      await context.globalState.update(ENDPOINT, address);
      await vscode.workspace.getConfiguration("comprehensionGuard").update("desktopSyncEnabled", true, vscode.ConfigurationTarget.Global);
      await flush(context);
      const box = outbox(context);
      void vscode.window.showInformationMessage(box.connected ? "Desktop dashboard connected." : "Pairing saved. Start the backend; pending checks will retry automatically.");
    } catch (e) { void vscode.window.showErrorMessage("Desktop connection: " + (e instanceof Error ? e.message : "failed")); }
  }));
  context.subscriptions.push(vscode.commands.registerCommand("comprehensionGuard.desktopStatus", async () => {
    const box = outbox(context);
    if (enabled()) await flush(context);
    const last = context.globalState.get<number>(LAST_SYNC);
    const quarantined = await box.quarantined();
    const rejected = quarantined.length ? ` Quarantined (${quarantined.length}) in ${path.join(box.directory, "quarantine")}: ${quarantined.slice(0, 5).map(q => q.file + " (" + q.reason + ")").join("; ")}${quarantined.length > 5 ? "; more files in that folder" : ""}.` : "";
    void vscode.window.showInformationMessage(`Desktop sync: ${enabled() ? box.connected ? "connected" : "waiting for desktop" : "off"}. Pending: ${(await box.pending()).length}. Last synced: ${last ? new Date(last).toLocaleString() : "never"}.${box.lastError ? " " + box.lastError : ""}${rejected}`);
  }));
  retry();
}

export const newDashboardCheckId = () => randomUUID();
