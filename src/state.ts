import * as vscode from "vscode";
import type { GradingMode, GuardMode, Provider } from "./types";

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
  /** True while a quiz must be answered, bypassed, or closed. */
  quizActive: false,
  /** Set when Bypass is used during an open quiz. Keeps the code. */
  bypassDuringQuiz: false,
};

const bypassListeners = new Set<() => void>();

/** Fires whenever `bypassArmed` changes so UI (status bar) can refresh. */
export const onStateChanged = new vscode.EventEmitter<void>();

/** Arms or disarms the one-shot bypass and notifies listeners. */
export function setBypassArmed(value: boolean): void {
  if (state.bypassArmed !== value) {
    state.bypassArmed = value;
    onStateChanged.fire();
  }
}

export function setQuizActive(value: boolean): void {
  if (state.quizActive !== value) {
    state.quizActive = value;
    if (!value) {
      state.bypassDuringQuiz = false;
    }
    onStateChanged.fire();
  }
}

/** Ends the open quiz and keeps the inserted code. Returns false if no quiz is open. */
export function requestQuizBypass(): boolean {
  if (!state.quizActive) {
    return false;
  }
  state.bypassDuringQuiz = true;
  for (const listener of bypassListeners) {
    listener();
  }
  onStateChanged.fire();
  return true;
}

export function subscribeQuizBypass(listener: () => void): () => void {
  bypassListeners.add(listener);
  return () => {
    bypassListeners.delete(listener);
  };
}

export function takeQuizBypass(): boolean {
  const requested = state.bypassDuringQuiz;
  state.bypassDuringQuiz = false;
  return requested;
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

export function getMode(): GuardMode {
  return vscode.workspace
    .getConfiguration("comprehensionGuard")
    .get<GuardMode>("mode", "auto");
}

export function getWalkthroughFileThreshold(): number {
  return vscode.workspace
    .getConfiguration("comprehensionGuard")
    .get<number>("walkthroughFileThreshold", 7);
}

export function getWalkthroughLineThreshold(): number {
  return vscode.workspace
    .getConfiguration("comprehensionGuard")
    .get<number>("walkthroughLineThreshold", 500);
}

export function wantsWalkthrough(fileCount: number, lineCount: number): boolean {
  const mode = getMode();
  if (mode === "learn") {
    return false;
  }
  if (mode === "walkthrough") {
    return fileCount > 1;
  }
  return (
    fileCount >= getWalkthroughFileThreshold() ||
    lineCount >= getWalkthroughLineThreshold()
  );
}
