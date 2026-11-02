import * as vscode from "vscode";
import { getCharThreshold, insertedRange, isEnabled, setBypassArmed, state } from "./state";
import { runComprehensionGate } from "./quiz";

/**
 * Registers the inline-insertion guard.
 *
 * This catches code that never touches the clipboard -- Copilot/Cursor
 * completions, "apply" from an AI chat, snippet expansion, etc. -- by
 * listening for large single-shot insertions via
 * `workspace.onDidChangeTextDocument`.
 *
 * The inserted code stays visible during the quiz. It is removed only when
 * the student does not pass.
 */
export function registerEditGuard(context: vscode.ExtensionContext): void {
  const disposable = vscode.workspace.onDidChangeTextDocument(async (event) => {
    // Ignore our own edits (paste / undo / re-insert) and no-op states.
    if (state.suppressEditGuard || state.processing || !isEnabled()) {
      return;
    }

    // Only guard the document the user is actively editing.
    const editor = vscode.window.activeTextEditor;
    if (!editor || event.document !== editor.document) {
      return;
    }

    // Ignore non-user events like output/other schemes.
    if (event.document.uri.scheme !== "file" && event.document.uri.scheme !== "untitled") {
      return;
    }

    const threshold = getCharThreshold();
    const bigChange = event.contentChanges.find(
      (change) => change.text.length >= threshold,
    );
    if (!bigChange) {
      return;
    }

    // A bypass is armed -> let this one through, consume the bypass.
    if (state.bypassArmed) {
      setBypassArmed(false);
      return;
    }

    const snippet = bigChange.text;
    const placed = insertedRange(bigChange.range.start, snippet);

    state.suppressEditGuard = true;
    state.processing = true;
    try {
      const passed = await runComprehensionGate(
        snippet,
        context,
        editor.document.languageId,
      );
      if (!passed && editor.document.getText(placed) === snippet) {
        await editor.edit((builder) => {
          builder.delete(placed);
        });
      }
    } finally {
      state.processing = false;
      state.suppressEditGuard = false;
    }
  });

  context.subscriptions.push(disposable);
}
