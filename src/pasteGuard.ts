import * as vscode from "vscode";
import { lockDocument } from "./documentLock";
import { noteAccepted } from "./editorBaseline";
import {
  getCharThreshold,
  insertedRange,
  isEnabled,
  setBypassArmed,
  setQuizActive,
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
 *  3. Otherwise paste, then lock the file until the check is answered,
 *     bypassed, or closed. A pass, bypass, or explanation keeps the paste.
 *     Closing or failing removes it.
 *
 * All real paste operations are wrapped so the edit guard ignores them.
 */
export function registerPasteGuard(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    "comprehensionGuard.paste",
    async () => {
      if (state.quizActive || state.processing) {
        vscode.window.setStatusBarMessage(
          "Comprehension Guard: finish the open quiz before pasting again.",
          3000,
        );
        return;
      }

      const editor = vscode.window.activeTextEditor;
      const selection = editor?.selection;
      const clipboardText = await vscode.env.clipboard.readText();

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
          { source: "paste", filePath: editor?.document.uri.fsPath },
        );
        if (passed) {
          await performPaste();
        }
        return;
      }

      state.suppressEditGuard = true;
      state.processing = true;
      setQuizActive(true);
      const placed = await insertSnippet(editor, selection, clipboardText);
      state.suppressEditGuard = false;
      if (!placed) {
        state.processing = false;
        setQuizActive(false);
        return;
      }
      const release = lockDocument(editor.document);
      let released = false;
      const unlock = (): void => {
        if (!released) {
          released = true;
          release();
        }
      };
      try {
        const passed = await runComprehensionGate(
          clipboardText,
          context,
          editor.document.languageId,
          { source: "paste", filePath: editor.document.uri.fsPath, editor, range: placed },
        );
        unlock();
        if (!passed && editor.document.getText(placed) === clipboardText) {
          state.suppressEditGuard = true;
          await editor.edit((builder) => {
            builder.delete(placed);
          });
          state.suppressEditGuard = false;
        }
      } finally {
        unlock();
        if (editor.document.uri.scheme === "file") {
          try {
            noteAccepted(editor.document.uri.fsPath, editor.document.getText());
          } catch {
            // The editor can close while the quiz is open.
          }
        }
        state.processing = false;
        state.suppressEditGuard = false;
        setQuizActive(false);
      }
    },
  );

  context.subscriptions.push(disposable);
}

/** Inserts the clipboard text and returns the range it occupies. */
async function insertSnippet(
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
      "Comprehension Guard: could not paste into the editor.",
    );
    return undefined;
  }
  return insertedRange(selection.start, text);
}

/** Runs the built-in paste while suppressing the edit guard. */
async function performPaste(): Promise<void> {
  await withoutEditGuard(async () => {
    await vscode.commands.executeCommand(BUILTIN_PASTE);
  });
}
