import * as vscode from "vscode";
import type { GradingMode, Provider } from "./types";

/**
 * Shared, process-local mutable state for the extension.
 *
 * - `suppressEditGuard` is a re-entrancy flag: it is set while the extension
 *   itself is mutating the document (performing the real paste, undoing a
 *   flagged insertion, or re-inserting an approved snippet) so that the
 *   `onDidChangeTextDocument` edit guard ignores its own edits.
 * - `bypassArmed` is a one-shot deadline escape hatch that skips the next
 *   comprehension check.
 * - `processing` prevents overlapping gates from stacking when edits fire
 *   rapidly.
 */
export const state = {
  suppressEditGuard: false,
  bypassArmed: false,
  processing: false,
};

/** Fires whenever `bypassArmed` changes so UI (status bar) can refresh. */
export const onStateChanged = new vscode.EventEmitter<void>();

/** Arms or disarms the one-shot bypass and notifies listeners. */
export function setBypassArmed(value: boolean): void {
  if (state.bypassArmed !== value) {
    state.bypassArmed = value;
    onStateChanged.fire();
  }
}

/** Range occupied by `text` after it is inserted at `start`. */
export function insertedRange(start: vscode.Position, text: string): vscode.Range {
  const lines = text.split(/\r?\n/);
  const last = lines[lines.length - 1] ?? "";
  const endLine = start.line + lines.length - 1;
  const endCharacter = lines.length === 1 ? start.character + last.length : last.length;
  return new vscode.Range(start, new vscode.Position(endLine, endCharacter));
}

/**
 * Runs an edit the guard itself is making. The document-change event can
 * arrive after the edit promise resolves, so the flag stays up briefly.
 */
export async function withoutEditGuard(action: () => Promise<void>): Promise<void> {
  state.suppressEditGuard = true;
  try {
    await action();
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 150));
    state.suppressEditGuard = false;
  }
}

export function isEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("comprehensionGuard")
    .get<boolean>("enabled", true);
}

export function getCharThreshold(): number {
  return vscode.workspace
    .getConfiguration("comprehensionGuard")
    .get<number>("charThreshold", 200);
}

export function getMinAnswerLength(): number {
  return vscode.workspace
    .getConfiguration("comprehensionGuard")
    .get<number>("minAnswerLength", 15);
}

export function getProvider(): Provider {
  return vscode.workspace
    .getConfiguration("comprehensionGuard")
    .get<Provider>("provider", "openai");
}

export function getModel(): string {
  return vscode.workspace
    .getConfiguration("comprehensionGuard")
    .get<string>("model", "");
}

export function getGradingMode(): GradingMode {
  return vscode.workspace
    .getConfiguration("comprehensionGuard")
    .get<GradingMode>("gradingMode", "free-text");
}

export function getNonCriticalPassFraction(): number {
  return vscode.workspace
    .getConfiguration("comprehensionGuard")
    .get<number>("nonCriticalPassFraction", 0.5);
}

export function getMaxFollowups(): number {
  return vscode.workspace
    .getConfiguration("comprehensionGuard")
    .get<number>("maxFollowups", 3);
}
