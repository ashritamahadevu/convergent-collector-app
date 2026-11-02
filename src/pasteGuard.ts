import * as vscode from "vscode";
import {
  getCharThreshold,
  insertedRange,
  isEnabled,
  setBypassArmed,
  state,
  withoutEditGuard,
} from "./state";
import { runComprehensionGate } from "./quiz";

const BUILTIN_PASTE = "editor.action.clipboardPasteAction";

/**
 * Registers the guarded paste command bound to Ctrl+V / Cmd+V.
 *
 * Flow:
 *  1. Read the clipboard text.
 *  2. If the guard is disabled, a bypass is armed, or the text is below the
 *     character threshold, run the real paste (consuming any armed bypass).
 *  3. Otherwise run the comprehension gate first; only paste on a pass.
 *
 * All real paste operations are wrapped so the edit guard ignores them.
 */
export function registerPasteGuard(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    "comprehensionGuard.paste",
    async () => {
      const editor = vscode.window.activeTextEditor;
      const selection = editor?.selection;
      const clipboardText = await vscode.env.clipboard.readText();

      // Below threshold, disabled, or a bypass is armed -> just paste.
      if (
        !isEnabled() ||
        state.bypassArmed ||
        clipboardText.length < getCharThreshold()
      ) {
        if (state.bypassArmed) {
          setBypassArmed(false);
        }
        await performPaste();
        return;
      }

      if (!editor || !selection) {
        const passed = await runComprehensionGate(
          clipboardText,
          context,
          editor?.document.languageId,
        );
        if (passed) {
          await performPaste();
        }
        return;
      }

      // Show the code in the editor during the quiz. Remove it if they do not pass.
      state.suppressEditGuard = true;
      state.processing = true;
      let placed: vscode.Range | undefined;
      try {
        placed = await insertPreview(editor, selection, clipboardText);
        const passed = await runComprehensionGate(
          clipboardText,
          context,
          editor.document.languageId,
        );
        if (!passed && placed) {
          await removeIfUnchanged(editor, placed, clipboardText);
        }
      } finally {
        state.processing = false;
        state.suppressEditGuard = false;
      }
    },
  );

  context.subscriptions.push(disposable);
}

/** Puts the snippet in the editor so it can be read during the quiz. */
async function insertPreview(
  editor: vscode.TextEditor,
  selection: vscode.Selection,
  text: string,
): Promise<vscode.Range | undefined> {
  await vscode.window.showTextDocument(editor.document, {
    viewColumn: editor.viewColumn,
    preserveFocus: false,
    selection,
  });
  const applied = await editor.edit((builder) => {
    builder.replace(selection, text);
  });
  if (!applied) {
    vscode.window.showWarningMessage(
      "Comprehension Guard: could not show the code in the editor.",
    );
    return undefined;
  }
  return insertedRange(selection.start, text);
}

/** Deletes a preview insertion that is still exactly the original snippet. */
async function removeIfUnchanged(
  editor: vscode.TextEditor,
  range: vscode.Range,
  text: string,
): Promise<void> {
  if (editor.document.getText(range) !== text) {
    return;
  }
  await editor.edit((builder) => {
    builder.delete(range);
  });
}

/** Runs the built-in paste while suppressing the edit guard. */
async function performPaste(): Promise<void> {
  await withoutEditGuard(async () => {
    await vscode.commands.executeCommand(BUILTIN_PASTE);
  });
}
