import * as vscode from "vscode";
import { state } from "./state";

/**
 * Freezes edits to one file while a comprehension check is open.
 * Does not steal focus, so the quiz panel can stay in front.
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
      state.suppressEditGuard = false;
    }
  });

  return () => {
    edits.dispose();
  };
}
