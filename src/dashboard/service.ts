import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DashboardOutbox } from "./outbox";
import { localEndpoint, type CheckEvent } from "./protocol";

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

/** Save locally before returning; network delivery is background work. */
export async function recordDashboardCheck(
  context: vscode.ExtensionContext,
  input: { eventId: string; timestamp: number; filePath?: string; check: CheckEvent["check"] },
): Promise<void> {
  if (!enabled() || vscode.env.remoteName) return;
  try {
    const file = input.filePath ? vscode.Uri.file(input.filePath) : undefined;
    const folder = file ? vscode.workspace.getWorkspaceFolder?.(file) : vscode.workspace.workspaceFolders?.[0];
    // Unknown/missing project identity must not expose absolute paths.
    const projectKey = folder?.uri.toString() ?? "unassigned";
    const relative = folder && input.filePath ? path.relative(folder.uri.fsPath, input.filePath).replace(/\\/g, "/") : null;
    const installationId = createHash("sha256").update(context.globalStorageUri.toString()).digest("hex");
    const event: CheckEvent = {
      schemaVersion: 1, type: "check.recorded", eventId: input.eventId,
      installationId, occurredAt: input.timestamp,
      project: { id: createHash("sha256").update(projectKey).digest("hex"), name: folder?.name ?? "Unassigned" },
      check: { ...input.check, filePath: relative },
    };
    const box = outbox(context);
    await box.enqueue(event);
    void flush(context).catch(() => {});
  } catch (e) {
    // A sync/storage failure must never change the quiz's grading or code gate.
    void vscode.window.showWarningMessage("Dashboard sync could not save this check: " + (e instanceof Error ? e.message : "storage error"));
  }
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
    void vscode.window.showInformationMessage(`Desktop sync: ${enabled() ? box.connected ? "connected" : "waiting for desktop" : "off"}. Pending: ${(await box.pending()).length}. Last synced: ${last ? new Date(last).toLocaleString() : "never"}.${box.lastError ? " " + box.lastError : ""}`);
  }));
  retry();
}

export const newDashboardCheckId = () => randomUUID();
