import { randomUUID } from "node:crypto";
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
import { beginQuestion, runComprehensionGate } from "./quiz";
import { InsertWindow, insertedSpans } from "./insertWindow";
import { rememberAcceptedSnippet, wasJustAccepted } from "./acceptedSnippets";

const WINDOW_MS = 750;
const windows = new InsertWindow(WINDOW_MS);
const deferred: { document: vscode.TextDocument; snippet: string }[] = [];

function guardedScheme(scheme: string): boolean {
  return scheme === "file"
    || scheme === "untitled"
    || scheme === "vscode-notebook-cell"
    || scheme === "vscode-remote"
    || scheme === "vscode-vfs";
}

async function deleteSpan(
  document: vscode.TextDocument,
  start: number,
  end: number,
): Promise<void> {
  const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
  state.suppressEditGuard = true;
  try {
    const work = new vscode.WorkspaceEdit();
    work.delete(document.uri, range);
    await vscode.workspace.applyEdit(work);
  } finally {
    state.suppressEditGuard = false;
  }
}
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
    if (state.suppressEditGuard || state.lockRestoring || !isEnabled()) {
      return;
    }

    if (!guardedScheme(event.document.uri.scheme)) {
      return;
    }

    // A reload from disk leaves a saved file clean. That is not an inline insertion.
    if (event.document.uri.scheme === "file" && !event.document.isDirty) {
      return;
    }

    if (
      event.document.uri.scheme === "file" &&
      isAgentClaimed(event.document.uri.fsPath)
    ) {
      return;
    }

    if (state.quizActive || state.processing) {
      const spans = insertedSpans(event.contentChanges.map((change) => ({
        rangeOffset: change.rangeOffset,
        rangeLength: change.rangeLength,
        text: change.text,
      })));
      const snippet = spans.map((span) => span.text).join("");
      if (snippet.length >= getCharThreshold()) {
        const last = spans[spans.length - 1];
        if (last) {
          await deleteSpan(event.document, last.start, last.end);
        }
        deferred.push({ document: event.document, snippet });
      }
      return;
    }

    const editor = vscode.window.visibleTextEditors.find(
      (item) => item.document === event.document,
    ) ?? vscode.window.activeTextEditor;
    if (!editor || event.document !== editor.document) {
      return;
    }

    const threshold = getCharThreshold();
    const spans = insertedSpans(event.contentChanges.map((change) => ({
      rangeOffset: change.rangeOffset,
      rangeLength: change.rangeLength,
      text: change.text,
    })));
    const inserted = spans.map((span) => span.text).join("");
    const windowKey = event.document.uri.toString();
    const accumulated = inserted.length > 0 ? windows.add(windowKey, inserted) : undefined;
    const bigChange = event.contentChanges.find((change) => change.text.length >= threshold);
    const snippet = bigChange?.text
      ?? (accumulated && accumulated.chars >= threshold ? accumulated.text : "");
    if (!snippet) {
      return;
    }
    if (wasJustAccepted(snippet)) {
      windows.clear(windowKey);
      return;
    }

    if (state.bypassArmed) {
      setBypassArmed(false);
      if (editor.document.uri.scheme === "file") {
        noteAccepted(editor.document.uri.fsPath, editor.document.getText());
      }
      return;
    }

    const anchor = bigChange ?? event.contentChanges[event.contentChanges.length - 1];
    const start = anchor?.range.start ?? new vscode.Position(0, 0);
    const placed = insertedRange(start, bigChange?.text ?? snippet);

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

    windows.clear(windowKey);
    setQuizActive(true);
    state.processing = true;
    const prepared = beginQuestion(
      context,
      snippet,
      editor.document.languageId,
      undefined,
      editor.document.uri.scheme === "file" ? editor.document.uri.fsPath : undefined,
    );
    const current = editor.document.getText();
    const startOffset = editor.document.offsetAt(placed.start);
    const endOffset = editor.document.offsetAt(placed.end);
    const before = current.slice(0, startOffset) + current.slice(endOffset);
    const lock = lockDocument(editor.document, before);
    try {
      const passed = await runComprehensionGate(
        snippet,
        context,
        editor.document.languageId,
        {
          source: "inline",
          shape: "general",
          groupId: randomUUID(),
          filePath: editor.document.uri.scheme === "file" ? editor.document.uri.fsPath : undefined,
          prepared,
          editor,
          range: placed,
          lock,
        },
      );
      if (passed) {
        lock.accept();
        rememberAcceptedSnippet(snippet);
      }
      lock.release();
      if (!passed && editor.document.getText(placed) === snippet) {
        state.suppressEditGuard = true;
        await editor.edit((builder) => {
          builder.delete(placed);
        });
        state.suppressEditGuard = false;
      }
    } finally {
      lock.release();
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
      await quizDeferred(context);
    }
  });

  context.subscriptions.push(disposable);
}

async function quizDeferred(context: vscode.ExtensionContext): Promise<void> {
  const next = deferred.shift();
  if (!next) {
    return;
  }
  setQuizActive(true);
  state.processing = true;
  try {
    const passed = await runComprehensionGate(
      next.snippet,
      context,
      next.document.languageId,
      {
        source: "inline",
        shape: "general",
        groupId: randomUUID(),
        filePath: next.document.uri.scheme === "file" ? next.document.uri.fsPath : undefined,
      },
    );
    if (passed) {
      const end = next.document.lineAt(Math.max(0, next.document.lineCount - 1)).range.end;
      const work = new vscode.WorkspaceEdit();
      work.insert(next.document.uri, end, next.snippet);
      state.suppressEditGuard = true;
      await vscode.workspace.applyEdit(work);
      rememberAcceptedSnippet(next.snippet);
    }
  } finally {
    state.suppressEditGuard = false;
    state.processing = false;
    setQuizActive(false);
    if (deferred.length > 0) {
      await quizDeferred(context);
    }
  }
}
