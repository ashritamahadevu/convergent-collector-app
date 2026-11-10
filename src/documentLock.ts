import * as vscode from "vscode";
import { state } from "./state";

export type DocumentLock = {
  release(): void;
  pause(): void;
  resume(): void;
};

/**
 * Freezes edits to one file while a comprehension check is open.
 * pause() lets a debug question plant a bug and accept edits.
 * resume() snapshots the file as it is now and starts freezing again.
 */
export function lockDocument(document: vscode.TextDocument): DocumentLock {
  let snapshot = document.getText();
  let paused = false;
  let restoring = false;
  let disposed = false;

  const edits = vscode.workspace.onDidChangeTextDocument(async (event) => {
    if (paused || disposed || restoring || event.document !== document || event.contentChanges.length === 0) {
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

  return {
    release() {
      disposed = true;
      edits.dispose();
    },
    pause() {
      paused = true;
    },
    resume() {
      snapshot = document.getText();
      paused = false;
    },
  };
}
