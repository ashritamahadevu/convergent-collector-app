import * as vscode from "vscode";
import { getCards, getFileKnowledge, getMastery } from "./memory/remember";
import { fileUnderstanding } from "./memory/understanding";

export function showUnderstandingMap(): void {
  const panel = vscode.window.createWebviewPanel(
    "comprehensionGuard.map",
    "Understanding map",
    vscode.ViewColumn.Active,
    { enableScripts: false },
  );
  panel.webview.html = "<html><body><p>Open this from the extension command so it can read your progress.</p></body></html>";
}

export function showUnderstandingMapFor(context: vscode.ExtensionContext): void {
  const rows = fileUnderstanding(
    getFileKnowledge(context),
    getMastery(context),
    getCards(context),
    Date.now(),
  );
  const panel = vscode.window.createWebviewPanel(
    "comprehensionGuard.map",
    "Understanding map",
    vscode.ViewColumn.Beside,
    { enableScripts: false },
  );
  const items = rows.map((row) => {
    const mark = row.status === "understood" ? "understood" : row.status === "skipped" ? "skipped" : row.status;
    return "<li><code>" + escapeHtml(row.path) + "</code> " + mark +
      (row.core ? " core" : "") +
      (row.complexity ? " complexity " + row.complexity : "") +
      "</li>";
  }).join("");
  panel.webview.html = "<html><body style=\"font-family:sans-serif;padding:16px\"><h2>Understanding map</h2><ul>" +
    (items || "<li>No files recorded yet.</li>") + "</ul></body></html>";
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
