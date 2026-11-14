import * as vscode from "vscode";
import { state } from "./state";

export type DocumentLock = {
  release(): void;
  pause(): void;
  resume(): void;
  /** The text now in the editor is allowed to be saved. */
  accept(): void;
};

const MAX_RESTORES = 8;

/**
 * Freezes edits to one file while a comprehension check is open.
 * pause() lets a debug question plant a bug and accept edits.
 * resume() snapshots the file as it is now and starts freezing again.
 * Saves during the quiz write `persistedText` (the file from before the
 * insertion) so autosave cannot keep held code on disk.
 */
export function lockDocument(
  document: vscode.TextDocument,
  persistedText?: string,
): DocumentLock {
  let snapshot = document.getText();
  let persisted = persistedText ?? snapshot;
  let paused = false;
  let restoring = false;
  let disposed = false;
  let restores = 0;

  const wholeRange = (): vscode.Range => {
    const end = document.lineAt(Math.max(0, document.lineCount - 1)).range.end;
    return new vscode.Range(new vscode.Position(0, 0), end);
  };

  const edits = vscode.workspace.onDidChangeTextDocument(async (event) => {
    if (paused || disposed || restoring || event.document !== document || event.contentChanges.length === 0) {
      return;
    }
    if (restores >= MAX_RESTORES) {
      return;
    }
    restores += 1;
    restoring = true;
    state.lockRestoring = true;
    try {
      const whole = wholeRange();
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
      state.lockRestoring = false;
    }
  });

  const saves = vscode.workspace.onWillSaveTextDocument((event) => {
    if (disposed || paused || event.document !== document) {
      return;
    }
    const edit = vscode.TextEdit.replace(wholeRange(), persisted);
    event.waitUntil(Promise.resolve([edit]));
  });

  const renames = vscode.workspace.onDidRenameFiles((event) => {
    for (const file of event.files) {
      if (file.oldUri.toString() === document.uri.toString()) {
        persisted = document.getText();
      }
    }
  });

  return {
    release() {
      disposed = true;
      edits.dispose();
      saves.dispose();
      renames.dispose();
      state.lockRestoring = false;
    },
    pause() {
      paused = true;
    },
    resume() {
      snapshot = document.getText();
      paused = false;
      restores = 0;
    },
    accept() {
      persisted = document.getText();
      snapshot = persisted;
    },
  };
}
