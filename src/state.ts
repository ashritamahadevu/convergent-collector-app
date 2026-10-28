import * as vscode from "vscode";

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
