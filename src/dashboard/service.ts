import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DashboardOutbox } from "./outbox";
import {
  isRelativePath,
  isSettingsEvent,
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
  type SettingsEvent,
} from "./protocol";

const SECRET = "comprehensionGuard.desktopToken";
const ENDPOINT = "comprehensionGuard.desktopEndpoint";
const LAST_SYNC = "comprehensionGuard.desktopLastSyncedAt";
const SETTINGS_AT = "comprehensionGuard.desktopSettingsUpdatedAt";
const PROFILE_KEY = "comprehensionGuard.profile";
const services = new WeakMap<vscode.ExtensionContext, DashboardOutbox>();
const enabled = () => vscode.workspace.getConfiguration("comprehensionGuard").get<boolean>("desktopSyncEnabled", false);
let suppressSettingsPush = false;

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
  await pullSettings(context);
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
  if (!enabled() || vscode.env.remoteName) return;
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
  if (!enabled() || vscode.env.remoteName) return;
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
    topic?: string;
    ease: number;
    intervalDays: number;
    repetitions: number;
    dueAt: number;
    stability: number;
    difficulty: number;
    lastReview: number;
  },
): Promise<void> {
  if (!enabled() || vscode.env.remoteName) return;
  const event: RecallEvent = {
    schemaVersion: 1,
    type: "recall.updated",
    eventId: "recall-" + createHash("sha256").update(row.topic || row.concept).digest("hex").slice(0, 24),
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
  if (!enabled() || vscode.env.remoteName) return;
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
  if (!enabled() || vscode.env.remoteName) return;
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
  if (!enabled() || vscode.env.remoteName) return;
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

type LearnerProfile = { examDate?: string; interviewDate?: string; preferredLanguage?: string; strictness?: string };

function readProfile(context: vscode.ExtensionContext): LearnerProfile {
  const raw = context.globalState.get<unknown>(PROFILE_KEY);
  return raw && typeof raw === "object" ? raw as LearnerProfile : {};
}

function settingsSnapshot(context: vscode.ExtensionContext, updatedAt = Date.now()): SettingsEvent {
  const config = vscode.workspace.getConfiguration("comprehensionGuard");
  const profile = readProfile(context);
  return {
    schemaVersion: 1,
    type: "settings.updated",
    eventId: "settings",
    installationId: installationId(context),
    occurredAt: updatedAt,
    updatedAt,
    enabled: config.get<boolean>("enabled", true) ?? true,
    charThreshold: config.get<number>("charThreshold", 200) ?? 200,
    minAnswerLength: config.get<number>("minAnswerLength", 15) ?? 15,
    provider: config.get<string>("provider", "openai") ?? "openai",
    model: config.get<string>("model", "") ?? "",
    gradingMode: config.get<string>("gradingMode", "free-text") ?? "free-text",
    nonCriticalPassFraction: config.get<number>("nonCriticalPassFraction", 0.5) ?? 0.5,
    mode: config.get<string>("mode", "auto") ?? "auto",
    walkthroughFileThreshold: config.get<number>("walkthroughFileThreshold", 7) ?? 7,
    walkthroughLineThreshold: config.get<number>("walkthroughLineThreshold", 500) ?? 500,
    maxFollowups: config.get<number>("maxFollowups", 3) ?? 3,
    agentPause: config.get<boolean>("agentPause", true) ?? true,
    checkPreset: config.get<string>("checkPreset", "standard") ?? "standard",
    preferredLanguage: config.get<string>("preferredLanguage", "") ?? "",
    strictness: config.get<string>("strictness", "standard") || "standard",
    examDate: profile.examDate ?? "",
    interviewDate: profile.interviewDate ?? "",
  };
}

/** Push the current VS Code settings and profile dates. No-ops while a desktop bag is being applied. */
export async function recordSettings(context: vscode.ExtensionContext): Promise<void> {
  if (suppressSettingsPush || !enabled() || vscode.env.remoteName) return;
  const event = settingsSnapshot(context);
  if (!isSettingsEvent(event)) return;
  await context.globalState.update(SETTINGS_AT, event.updatedAt);
  await enqueueDashboard(context, event);
}

async function pushLocalSettings(context: vscode.ExtensionContext): Promise<void> {
  if (suppressSettingsPush || !enabled() || vscode.env.remoteName) return;
  const profile = readProfile(context);
  const config = vscode.workspace.getConfiguration("comprehensionGuard");
  const { saveProfile } = await import("../memory/remember.js");
  if (suppressSettingsPush) return;
  await saveProfile(context, {
    examDate: profile.examDate ?? "",
    interviewDate: profile.interviewDate ?? "",
    preferredLanguage: config.get<string>("preferredLanguage", "") ?? "",
    strictness: config.get<string>("strictness", "standard") || "standard",
  });
}

async function applyRemoteSettings(context: vscode.ExtensionContext, event: SettingsEvent): Promise<void> {
  suppressSettingsPush = true;
  try {
    const config = vscode.workspace.getConfiguration("comprehensionGuard");
    const target = vscode.ConfigurationTarget.Global;
    const fields: [string, string | number | boolean][] = [
      ["enabled", event.enabled],
      ["charThreshold", event.charThreshold],
      ["minAnswerLength", event.minAnswerLength],
      ["provider", event.provider],
      ["model", event.model],
      ["gradingMode", event.gradingMode],
      ["nonCriticalPassFraction", event.nonCriticalPassFraction],
      ["mode", event.mode],
      ["walkthroughFileThreshold", event.walkthroughFileThreshold],
      ["walkthroughLineThreshold", event.walkthroughLineThreshold],
      ["maxFollowups", event.maxFollowups],
      ["agentPause", event.agentPause],
      ["checkPreset", event.checkPreset],
      ["preferredLanguage", event.preferredLanguage],
      ["strictness", event.strictness],
    ];
    for (const [key, value] of fields) await config.update(key, value, target);
    const { saveProfile } = await import("../memory/remember.js");
    await saveProfile(context, {
      examDate: event.examDate,
      interviewDate: event.interviewDate,
      preferredLanguage: event.preferredLanguage,
      strictness: event.strictness,
    }, false);
    await context.globalState.update(SETTINGS_AT, event.updatedAt);
  } finally {
    suppressSettingsPush = false;
  }
}

async function pullSettings(context: vscode.ExtensionContext): Promise<void> {
  try {
    const link = await connection(context);
    if (!link) return;
    const response = await fetch(localEndpoint(link.endpoint) + "/v1/settings", {
      headers: { Authorization: "Bearer " + link.token },
      redirect: "error",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return;
    const body = await response.json() as { settings?: unknown };
    if (body.settings == null || !isSettingsEvent(body.settings)) return;
    const applied = context.globalState.get<number>(SETTINGS_AT) ?? 0;
    if (body.settings.updatedAt <= applied) return;
    await applyRemoteSettings(context, body.settings);
  } catch {
    // Keep the local values. The next flush tries again.
  }
}

export async function recordPrepSet(
  context: vscode.ExtensionContext,
  kind: "interview" | "exam",
  project: string,
  questions: PrepQuestion[],
): Promise<void> {
  if (!enabled() || vscode.env.remoteName) return;
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
    if (suppressSettingsPush) return;
    const changed = e.affectsConfiguration("comprehensionGuard");
    const syncToggle = e.affectsConfiguration("comprehensionGuard.desktopSyncEnabled");
    if (!changed && !syncToggle) return;
    void (async () => {
      if (changed) await pushLocalSettings(context);
      if (syncToggle) retry();
    })();
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
