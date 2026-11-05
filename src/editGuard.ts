import * as vscode from "vscode";
import { looksLikeAgentInvocation } from "./agentProtocol";
import { lockDocument } from "./documentLock";
import { noteAccepted } from "./editorBaseline";
import { isAgentClaimed, markEditorGate } from "./gateLock";
import {
  getCharThreshold,
  insertedRange,
  isEnabled,
  setBypassArmed,
  setQuizActive,
  state,
} from "./state";
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
 * the student does not pass. Agent-hook writes are left to the agent guard
 * so the same edit is not quizzed twice.
 */
export function registerEditGuard(context: vscode.ExtensionContext): void {
  const disposable = vscode.workspace.onDidChangeTextDocument(async (event) => {
    if (state.suppressEditGuard || !isEnabled()) {
      return;
    }

    if (event.document.uri.scheme !== "file" && event.document.uri.scheme !== "untitled") {
      return;
    }

    if (
      event.document.uri.scheme === "file" &&
      isAgentClaimed(event.document.uri.fsPath)
    ) {
      return;
    }

    if (state.quizActive || state.processing) {
      return;
    }

    const editor = vscode.window.visibleTextEditors.find(
      (item) => item.document === event.document,
    ) ?? vscode.window.activeTextEditor;
    if (!editor || event.document !== editor.document) {
      return;
    }

    const threshold = getCharThreshold();
    const bigChange = event.contentChanges.find(
      (change) => change.text.length >= threshold,
    );
    if (!bigChange) {
      return;
    }

    if (state.bypassArmed) {
      setBypassArmed(false);
      if (editor.document.uri.scheme === "file") {
        noteAccepted(editor.document.uri.fsPath, editor.document.getText());
      }
      return;
    }

    const snippet = bigChange.text;
    const start = bigChange.range.start;
    const placed = insertedRange(start, snippet);

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

    if (editor.document.uri.scheme === "file") {
      markEditorGate(editor.document.uri.fsPath, snippet);
    }

    setQuizActive(true);
    state.processing = true;
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
        snippet,
        context,
        editor.document.languageId,
      );
      unlock();
      if (!passed && editor.document.getText(placed) === snippet) {
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
      setQuizActive(false);
    }
  });

  context.subscriptions.push(disposable);
}
