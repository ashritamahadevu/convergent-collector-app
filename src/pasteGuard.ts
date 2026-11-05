import * as vscode from "vscode";
import { noteAccepted } from "./editorBaseline";
import {
  getCharThreshold,
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
 *  3. Otherwise run the comprehension gate first. The clipboard stays out of
 *     the file until the check is passed or bypassed.
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

      // Keep the clipboard out of the file until the check passes.
      state.suppressEditGuard = true;
      state.processing = true;
      try {
        const passed = await runComprehensionGate(
          clipboardText,
          context,
          editor.document.languageId,
        );
        if (passed) {
          const applied = await insertSnippet(editor, selection, clipboardText);
          if (!applied) {
            vscode.window.showWarningMessage(
              "Comprehension Guard: the answer was accepted, but the paste could not be inserted.",
            );
          }
        }
      } finally {
        if (editor.document.uri.scheme === "file") {
          try {
            noteAccepted(editor.document.uri.fsPath, editor.document.getText());
          } catch {
            // The editor can close while the quiz is open.
          }
        }
        state.processing = false;
        state.suppressEditGuard = false;
      }
    },
  );

  context.subscriptions.push(disposable);
}

/** Inserts clipboard text after the comprehension check has passed. */
async function insertSnippet(
  editor: vscode.TextEditor,
  selection: vscode.Selection,
  text: string,
): Promise<boolean> {
  await vscode.window.showTextDocument(editor.document, {
    viewColumn: editor.viewColumn,
    preserveFocus: false,
    selection,
  });
  return editor.edit((builder) => {
    builder.replace(selection, text);
  });
}

/** Runs the built-in paste while suppressing the edit guard. */
async function performPaste(): Promise<void> {
  await withoutEditGuard(async () => {
    await vscode.commands.executeCommand(BUILTIN_PASTE);
  });
}
