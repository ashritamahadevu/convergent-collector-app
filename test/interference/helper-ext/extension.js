// Test-only extension that behaves like other extensions a student might run
// next to Comprehension Guard: an AI inline-completion provider, an "apply
// edit" chat extension, a snippet inserter, a streaming inline-chat style
// writer, and an agent extension that writes files with workspace.fs.
// Every edit is made from this extension's own API object, exactly like a
// third-party extension would.
const vscode = require("vscode");

let inlineText = "";
let inlineCalls = 0;

function pos(doc, at) {
  if (!at || at === "end") {
    return doc.positionAt(doc.getText().length);
  }
  return new vscode.Position(at.line, at.character ?? 0);
}

function activate(context) {
  const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  // AI completion accepted the classic way: editor.edit on the active editor.
  reg("cgHelper.editorEdit", async (args) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return { ok: false, reason: "no active editor" };
    const ok = await editor.edit((b) => b.insert(pos(editor.document, args.at), args.text));
    return { ok };
  });

  // "Apply" from a chat panel: one WorkspaceEdit with several TextEdits.
  reg("cgHelper.workspaceEdit", async (args) => {
    const uri = vscode.Uri.parse(args.uri);
    const doc = await vscode.workspace.openTextDocument(uri);
    const we = new vscode.WorkspaceEdit();
    for (const e of args.edits) {
      we.insert(uri, pos(doc, e.at), e.text);
    }
    const ok = await vscode.workspace.applyEdit(we);
    return { ok };
  });

  // Snippet expansion / snippet-library extension.
  reg("cgHelper.snippet", async (args) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return { ok: false };
    const ok = await editor.insertSnippet(new vscode.SnippetString(args.text), pos(editor.document, args.at));
    return { ok };
  });

  // Inline chat / "apply" that streams its result in small chunks.
  reg("cgHelper.stream", async (args) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return { ok: false };
    const text = args.text;
    const size = args.chunk ?? 40;
    for (let i = 0; i < text.length; i += size) {
      const piece = text.slice(i, i + size);
      await editor.edit((b) => b.insert(editor.document.positionAt(editor.document.getText().length), piece), {
        undoStopBefore: false,
        undoStopAfter: false,
      });
      await new Promise((r) => setTimeout(r, args.delayMs ?? 25));
    }
    return { ok: true };
  });

  // Agent-style extension (Cline / Roo / Continue apply) writing straight to disk.
  reg("cgHelper.fsWrite", async (args) => {
    await vscode.workspace.fs.writeFile(vscode.Uri.parse(args.uri), Buffer.from(args.text, "utf8"));
    return { ok: true };
  });

  // Inline completion provider (Copilot-style ghost text).
  reg("cgHelper.setInline", (args) => {
    inlineText = args.text;
    inlineCalls = 0;
    return { ok: true };
  });
  reg("cgHelper.inlineCalls", () => inlineCalls);
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, {
      provideInlineCompletionItems(document, position) {
        inlineCalls += 1;
        if (!inlineText) return [];
        return [new vscode.InlineCompletionItem(inlineText, new vscode.Range(position, position))];
      },
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
