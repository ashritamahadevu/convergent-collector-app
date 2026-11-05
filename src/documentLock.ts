import * as vscode from "vscode";
import { state } from "./state";

/**
 * Freezes one file while a comprehension check is open.
 * Edits are reverted and other files cannot stay focused.
 * Call the returned function before keeping or deleting the code.
 */
export function lockDocument(document: vscode.TextDocument): () => void {
  const snapshot = document.getText();
  let restoring = false;

  const edits = vscode.workspace.onDidChangeTextDocument(async (event) => {
    if (restoring || event.document !== document || event.contentChanges.length === 0) {
      return;
    }
    restoring = true;
    state.suppressEditGuard = true;
    try {
      const end = document.lineAt(document.lineCount - 1).range.end;
      const whole = new vscode.Range(new vscode.Position(0, 0), end);
      const editor = vscode.window.visibleTextEditors.find(
        (item) => item.document === document,
      );
      if (editor) {
        await editor.edit((builder) => {
          builder.replace(whole, snapshot);
        });
      } else {
        const work = new vscode.WorkspaceEdit();
        work.replace(document.uri, whole, snapshot);
        await vscode.workspace.applyEdit(work);
      }
    } finally {
      restoring = false;
    }
  });

  const focus = vscode.window.onDidChangeActiveTextEditor(async (next) => {
    if (!next || next.document === document) {
      return;
    }
    await vscode.window.showTextDocument(document, {
      preserveFocus: false,
      preview: false,
    });
  });

  return () => {
    edits.dispose();
    focus.dispose();
  };
}
