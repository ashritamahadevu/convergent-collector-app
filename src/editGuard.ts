import * as vscode from "vscode";
import { getCharThreshold, isEnabled, setBypassArmed, state } from "./state";
import { runComprehensionGate } from "./quiz";

/**
 * Registers the inline-insertion guard.
 *
 * This catches code that never touches the clipboard -- Copilot/Cursor
 * completions, "apply" from an AI chat, snippet expansion, etc. -- by
 * listening for large single-shot insertions via
 * `workspace.onDidChangeTextDocument`.
 *
 * Because the text has already been inserted by the time the event fires, the
 * flow is: undo the insertion, hold the snippet, run the comprehension gate,
 * then re-insert on a pass (or leave it removed on a cancel).
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
    const insertStart = bigChange.range.start;

    state.processing = true;
    try {
      // Remove the just-inserted code while the student is challenged.
      await undoInsertion();

      const passed = await runComprehensionGate(snippet);
      if (passed) {
        await reinsert(editor, insertStart, snippet);
      }
      // On failure the code stays removed (undo already took it out).
    } finally {
      state.processing = false;
    }
  });

  context.subscriptions.push(disposable);
}

/** Undo the flagged insertion, suppressing re-entrant guard triggers. */
async function undoInsertion(): Promise<void> {
  state.suppressEditGuard = true;
  try {
    await vscode.commands.executeCommand("undo");
  } finally {
    state.suppressEditGuard = false;
  }
}

/** Re-insert an approved snippet at the original position. */
async function reinsert(
  editor: vscode.TextEditor,
  position: vscode.Position,
  snippet: string,
): Promise<void> {
  state.suppressEditGuard = true;
  try {
    await editor.edit((builder) => {
      builder.insert(position, snippet);
    });
  } finally {
    state.suppressEditGuard = false;
  }
}
