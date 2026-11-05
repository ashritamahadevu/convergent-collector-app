import * as vscode from "vscode";
import { looksLikeAgentInvocation } from "./agentProtocol";
import { noteAccepted } from "./editorBaseline";
import { isAgentClaimed, markEditorGate } from "./gateLock";
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
 * The insertion is removed immediately. It is written back only when the
 * student passes or bypasses the check.
 */
export function registerEditGuard(context: vscode.ExtensionContext): void {
  const disposable = vscode.workspace.onDidChangeTextDocument(async (event) => {
    // Ignore our own edits (paste / undo / re-insert) and no-op states.
    if (state.suppressEditGuard || state.processing || !isEnabled()) {
      return;
    }

    // An agent hook already owns this write. Quizzing it here would stack a second check.
    if (
      event.document.uri.scheme === "file" &&
      isAgentClaimed(event.document.uri.fsPath)
    ) {
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
      noteAccepted(editor.document.uri.fsPath, editor.document.getText());
      return;
    }

    const snippet = bigChange.text;
    const start = bigChange.range.start;
    const placed = insertedRange(start, snippet);

    // The Cursor CLI can echo the command you typed into the file. That is
    // not generated code, so drop it and wait for the real edit.
    if (looksLikeAgentInvocation(snippet)) {
      if (editor.document.getText(placed) === snippet) {
        state.suppressEditGuard = true;
        await editor.edit((builder) => {
          builder.delete(placed);
        });
        state.suppressEditGuard = false;
      }
      return;
    }

    markEditorGate(editor.document.uri.fsPath, snippet);
    state.suppressEditGuard = true;
    state.processing = true;
    let removed = false;
    try {
      if (editor.document.getText(placed) === snippet) {
        removed = await editor.edit((builder) => {
          builder.delete(placed);
        });
      }
      const passed = await runComprehensionGate(
        snippet,
        context,
        editor.document.languageId,
      );
      if (passed && removed) {
        const inserted = await editor.edit((builder) => {
          builder.insert(start, snippet);
        });
        if (!inserted) {
          vscode.window.showWarningMessage(
            "Comprehension Guard: the answer was accepted, but the code could not be inserted.",
          );
        }
      } else if (!passed && !removed && editor.document.getText(placed) === snippet) {
        await editor.edit((builder) => {
          builder.delete(placed);
        });
      }
    } finally {
      try {
        noteAccepted(editor.document.uri.fsPath, editor.document.getText());
      } catch {
        // The editor can close while the quiz is open.
      }
      state.processing = false;
      state.suppressEditGuard = false;
    }
  });

  context.subscriptions.push(disposable);
}
