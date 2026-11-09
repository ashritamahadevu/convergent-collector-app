// Scenario definitions. Each returns { result, observed, ...details }.
// result: PASS | BUG | INFO | UNTESTED
const fs = require("fs");
const path = require("path");

const ALL = ["plain", "formatters", "vim"];
const PLAIN = ["plain"];
const FMT = ["formatters"];
const VIM = ["vim"];
const tests = [];
const test = (id, name, profiles, fn, opts = {}) => tests.push({ id, name, profiles, fn, ...opts });

function verdict(ok, okMsg, badMsg, extra = {}) {
  return { result: ok ? "PASS" : "BUG", observed: ok ? okMsg : badMsg, ...extra };
}

async function pasteCmd(c) {
  // Run the guard's command without awaiting (it resolves when the quiz ends).
  const p = c.vscode.commands.executeCommand("comprehensionGuard.paste");
  p.then(undefined, (e) => (c.lastPasteError = String(e && e.message ? e.message : e)));
  return p;
}

async function vimMode(c) {
  // vim exposes its mode as a context key; read via the status bar text is not
  // available, so ask the extension's exported state when present.
  const ext = c.vscode.extensions.getExtension("vscodevim.vim");
  return ext ? "vim-active" : "";
}

// ================================================================ baseline
test("A1-paste-cmd-fail", "Guarded paste command, then close quiz (fail)", ALL, async (c) => {
  const { vscode } = c;
  const original = "const keep = 1;\n";
  const uri = c.file("a1.ts", original);
  const ed = await c.show(uri);
  c.cursorAtEnd(ed);
  const BIG = c.big("a1");
  await vscode.env.clipboard.writeText(BIG);
  c.lastPasteError = "";
  const p = pasteCmd(c);
  const opened = await c.waitQuiz();
  const during = ed.document.getText().includes(BIG);
  await c.failQuiz();
  await p.then(undefined, () => undefined);
  const after = ed.document.getText();
  return verdict(
    opened && during && after === original,
    "quiz opened, paste visible during quiz, removed after close",
    `opened=${opened} visibleDuring=${during} removedOnFail=${after === original} error=${c.lastPasteError || "none"}`,
  );
});

test("A1b-paste-cmd-bypass", "Guarded paste command, Bypass keeps code", ALL, async (c) => {
  const { vscode } = c;
  const uri = c.file("a1b.ts", "const keep = 1;\n");
  const ed = await c.show(uri);
  c.cursorAtEnd(ed);
  const BIG = c.big("a1b");
  await vscode.env.clipboard.writeText(BIG);
  const p = pasteCmd(c);
  const opened = await c.waitQuiz();
  await c.bypassQuiz();
  await p.then(undefined, () => undefined);
  const kept = ed.document.getText().includes(BIG);
  return verdict(opened && kept, "bypass kept the paste", `opened=${opened} kept=${kept}`);
});

test("A2-ctrlv-key-editor", "Real Ctrl+V keypress in a focused text editor", ALL, async (c) => {
  const { vscode } = c;
  const original = "const keep = 2;\n";
  const uri = c.file("a2.ts", original);
  const ed = await c.show(uri);
  c.cursorAtEnd(ed);
  await c.focusEditor();
  const BIG = c.big("a2");
  await vscode.env.clipboard.writeText(BIG);
  const focus = await c.activeElementInfo();
  await c.cdp.key("ctrl+v");
  const opened = await c.waitQuiz(4000);
  const inserted = ed.document.getText().includes(BIG);
  if (opened) await c.failQuiz();
  const after = ed.document.getText();
  const details = { focus, opened, inserted, removedOnFail: after === original };
  if (c.profile === "vim") {
    return {
      result: opened ? "PASS" : inserted ? "BUG" : "INFO",
      observed: opened
        ? "guard handled Ctrl+V in Vim normal mode"
        : inserted
          ? "Ctrl+V pasted without a quiz under Vim"
          : "Vim consumed Ctrl+V in normal mode (visual block); nothing pasted, no quiz",
      details,
    };
  }
  return verdict(opened && after === original, "Ctrl+V resolved to the guard; quiz opened; fail removed paste",
    `opened=${opened} inserted=${inserted} removedOnFail=${after === original}`, { details });
}, { needsCdp: true });

test("A3-inline-editoredit-fail", "Helper ext editor.edit 300+ chars in active editor, fail", ALL, async (c) => {
  const { vscode } = c;
  const original = "const keep = 3;\n";
  const uri = c.file("a3.ts", original);
  const ed = await c.show(uri);
  const BIG = c.big("a3");
  await vscode.commands.executeCommand("cgHelper.editorEdit", { text: BIG, at: "end" });
  const opened = await c.waitQuiz();
  const during = ed.document.getText().includes(BIG);
  await c.failQuiz();
  const after = ed.document.getText();
  return verdict(opened && after === original, "inline quiz opened and insertion removed on fail",
    `opened=${opened} visibleDuring=${during} removedOnFail=${after === original}`);
});

test("A5-guard-dead-after-fail", "After one failed inline quiz, is the guard still alive?", ALL, async (c) => {
  const { vscode } = c;
  const uri = c.file("a5.ts", "const keep = 5;\n");
  const ed = await c.show(uri);
  await vscode.commands.executeCommand("cgHelper.editorEdit", { text: c.big("a5x"), at: "end" });
  const first = await c.waitQuiz();
  await c.failQuiz();
  await c.sleep(3300);
  // Second, different insertion. No paste in between (a paste would reset the flag).
  await c.show(uri);
  const BIG2 = c.big("a5y");
  await vscode.commands.executeCommand("cgHelper.editorEdit", { text: BIG2, at: "end" });
  const second = await c.waitQuiz(4000);
  // And a disk change on an open background file.
  const bg = c.file("a5-bg.ts", "export const a = 1;\n");
  await c.show(bg);
  await c.show(c.file("a5-front.ts", "// front\n"));
  await c.sleep(300);
  if (second) await c.failQuiz();
  fs.writeFileSync(bg.fsPath, "export const a = 1;\n" + c.big("a5z"), "utf8");
  const third = await c.waitQuiz(6000);
  return verdict(first && second && third, "guard still quizzes after a failed inline quiz",
    `firstQuiz=${first} secondInlineQuiz=${second} diskFallbackQuiz=${third} (state.suppressEditGuard left true after the failed delete?)`);
});

test("A4-agent-disk-bg-pass", "Disk write to an open background file, answer quiz (pass)", ALL, async (c) => {
  const { vscode } = c;
  const original = "export const userCode = 1;\n";
  const uri = c.file("a4.ts", original);
  await c.show(uri);
  await c.show(c.file("a4-front.ts", "// front\n"));
  await c.sleep(300);
  const BIG = c.big("a4");
  fs.writeFileSync(uri.fsPath, original + BIG, "utf8");
  const opened = await c.waitQuiz(8000);
  await c.sleep(300);
  const diskDuring = c.disk(uri);
  const answered = opened ? await c.answerQuiz() : false;
  await c.sleep(800);
  const disk = c.disk(uri);
  return verdict(
    opened && answered && disk.includes(BIG) && !diskDuring.includes(BIG),
    "disk fallback quiz opened, code withheld during quiz, written back after pass",
    `opened=${opened} answered=${answered} heldDuring=${!diskDuring.includes(BIG)} diskAfterHasCode=${disk.includes(BIG)}`,
  );
}, { needsCdp: true });

test("A6-agent-disk-bg-fail", "Disk write to an open background file, close quiz (fail)", ALL, async (c) => {
  const original = "export const userCode = 6;\n";
  const uri = c.file("a6.ts", original);
  await c.show(uri);
  await c.show(c.file("a6-front.ts", "// front\n"));
  await c.sleep(300);
  fs.writeFileSync(uri.fsPath, original + c.big("a6"), "utf8");
  const opened = await c.waitQuiz(8000);
  await c.failQuiz();
  await c.sleep(800);
  const disk = c.disk(uri);
  return verdict(opened && disk === original, "agent code removed from disk on fail",
    `opened=${opened} diskRestored=${disk === original}`);
});

// ================================================ keybinding / focus contexts
test("K0-ctrlv-bindings", "Which Ctrl+V keybindings are registered (default keybindings file)", ALL, async (c) => {
  const { vscode } = c;
  await vscode.commands.executeCommand("workbench.action.openDefaultKeybindingsFile");
  await c.sleep(1200);
  const doc = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
  const text = doc ? doc.getText() : "";
  const rows = [];
  const re = /\{\s*"key":\s*"ctrl\+v",\s*"command":\s*"([^"]+)"(?:,\s*"when":\s*"([^"]*)")?/g;
  let m;
  while ((m = re.exec(text))) rows.push(m[1] + (m[2] ? " when " + m[2] : ""));
  return { result: "INFO", observed: `${rows.length} ctrl+v bindings (later wins): ` + rows.join(" | ") };
});

test("K1-readonly-editor", "Ctrl+V in a read-only editor (default keybindings view)", PLAIN, async (c) => {
  const { vscode } = c;
  await vscode.env.clipboard.writeText(c.big("k1"));
  await vscode.commands.executeCommand("workbench.action.openDefaultKeybindingsFile");
  await c.sleep(1000);
  await c.focusEditor();
  const before = vscode.window.activeTextEditor.document.getText();
  await c.cdp.key("ctrl+v");
  const opened = await c.waitQuiz(2500);
  const after = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.getText() : before;
  return verdict(!opened && before === after, "no quiz, no change in read-only editor",
    `opened=${opened} changed=${before !== after}`);
}, { needsCdp: true });

test("K2-scm-input", "Ctrl+V into the Source Control commit message box", PLAIN, async (c) => {
  const { vscode } = c;
  const original = "const keep = 22;\n";
  const uri = c.file("k2.ts", original);
  const ed = await c.show(uri);
  c.cursorAtEnd(ed);
  const git = vscode.extensions.getExtension("vscode.git");
  const api = (await git.activate()).getAPI(1);
  await c.waitFor(() => api.repositories.length > 0, 8000);
  const repo = api.repositories[0];
  if (!repo) return { result: "UNTESTED", observed: "git repository not detected in temp workspace" };
  repo.inputBox.value = "";
  const MSG = "Refactor totals\n\n" + "This commit message is long enough to cross the guard threshold. ".repeat(5);
  await vscode.env.clipboard.writeText(MSG);
  await vscode.commands.executeCommand("workbench.view.scm");
  await c.sleep(600);
  await vscode.commands.executeCommand("workbench.scm.action.focusNextInput").then(undefined, () => undefined);
  await c.sleep(300);
  const focus = await c.activeElementInfo();
  const activeUri = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri.toString() : "none";
  await c.cdp.key("ctrl+v");
  await c.sleep(150);
  const statusRightAfter = await c.guardStatus();
  const opened = await c.waitQuiz(3000);
  await c.sleep(300);
  const fileGotIt = ed.document.getText().includes(MSG.slice(0, 40));
  const boxGotIt = repo.inputBox.value.includes(MSG.slice(0, 40));
  const scmDocs = vscode.workspace.textDocuments.filter((d) => d.uri.scheme !== "file").map((d) => d.uri.scheme).join(",");
  const toasts = await c.cdp.evalMain(
    `[...document.querySelectorAll(".notification-toast, .notifications-toasts .monaco-list-row")].map((e) => e.textContent).join(" / ").slice(0, 300)`,
  );
  // Same text, same focus, below the threshold: does plain paste still work there?
  await vscode.env.clipboard.writeText("short message");
  await vscode.commands.executeCommand("workbench.view.scm");
  await c.sleep(300);
  await c.cdp.key("ctrl+v");
  await c.sleep(500);
  const smallWorks = repo.inputBox.value.includes("short message");
  c.note = `activeTextEditor=${activeUri} status=${statusRightAfter} openDocSchemes=${scmDocs} toasts=[${toasts}] smallPasteIntoScmWorks=${smallWorks}`;
  if (opened) await c.bypassQuiz();
  await c.sleep(300);
  const fileAfter = ed.document.getText().includes(MSG.slice(0, 40));
  const boxAfter = repo.inputBox.value.includes(MSG.slice(0, 40));
  repo.inputBox.value = "";
  const ok = !opened && !fileGotIt && !fileAfter;
  // Note: native paste from a CDP-synthesised Ctrl+V does not reach the SCM box
  // even for short text (smallPasteIntoScmWorks), so where the text lands is
  // not observable here; we only check the guard did not fire or touch the file.
  return verdict(ok, "guard did not fire in SCM input; code file untouched (native paste not observable via CDP)",
    `focus=${focus} quizOpened=${opened} pastedIntoActiveFile=${fileGotIt || fileAfter} scmBoxGotText=${boxGotIt || boxAfter} ${c.note}`);
}, { needsCdp: true });

test("K3-terminal", "Ctrl+V in the integrated terminal", PLAIN, async (c) => {
  const { vscode } = c;
  const original = "const keep = 33;\n";
  const uri = c.file("k3.ts", original);
  const ed = await c.show(uri);
  await vscode.env.clipboard.writeText("echo " + "x".repeat(300));
  const term = vscode.window.createTerminal("cg-test");
  term.show(false);
  await c.sleep(1500);
  await vscode.commands.executeCommand("workbench.action.terminal.focus");
  await c.sleep(300);
  const focus = await c.activeElementInfo();
  await c.cdp.key("ctrl+v");
  const opened = await c.waitQuiz(2500);
  const changed = ed.document.getText() !== original;
  term.dispose();
  return verdict(!opened && !changed, "terminal paste untouched by guard", `focus=${focus} quiz=${opened} fileChanged=${changed}`);
}, { needsCdp: true });

test("K4-debug-console", "Ctrl+V into the Debug Console input", PLAIN, async (c) => {
  const { vscode } = c;
  const original = "const keep = 44;\n";
  const uri = c.file("k4.ts", original);
  const ed = await c.show(uri);
  c.cursorAtEnd(ed);
  const BIG = c.big("k4");
  await vscode.env.clipboard.writeText(BIG);
  await vscode.commands.executeCommand("workbench.debug.action.focusRepl");
  await c.sleep(600);
  const focus = await c.activeElementInfo();
  await c.cdp.key("ctrl+v");
  const opened = await c.waitQuiz(3000);
  const fileGotIt = ed.document.getText().includes(BIG);
  if (opened) await c.bypassQuiz();
  const fileAfter = ed.document.getText().includes(BIG);
  return verdict(!opened && !fileGotIt && !fileAfter, "no quiz; code file untouched",
    `focus=${focus} quizOpened=${opened} pastedIntoActiveFile=${fileGotIt || fileAfter}`);
}, { needsCdp: true });

test("K5-settings-json", "Ctrl+V into user settings.json (vscode-userdata scheme)", PLAIN, async (c) => {
  const { vscode } = c;
  await vscode.commands.executeCommand("workbench.action.openSettingsJson");
  await c.sleep(1000);
  const ed = vscode.window.activeTextEditor;
  if (!ed) return { result: "UNTESTED", observed: "settings.json did not open" };
  const original = ed.document.getText();
  ed.selection = new vscode.Selection(1, 0, 1, 0);
  const BIG = Array.from({ length: 8 }, (_, i) => `  // pasted comment line ${i} with some explanatory text`).join("\n") + "\n";
  await vscode.env.clipboard.writeText(BIG);
  await c.focusEditor();
  await c.cdp.key("ctrl+v");
  const opened = await c.waitQuiz(3000);
  const inserted = ed.document.getText().includes(BIG);
  if (opened) await c.failQuiz();
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === ed.document.uri.toString());
  const restored = doc ? doc.getText() === original : false;
  // Inline insertion into settings.json from an extension.
  const we = new vscode.WorkspaceEdit();
  we.insert(ed.document.uri, new vscode.Position(1, 0), BIG.replace(/pasted/g, "inserted"));
  await vscode.workspace.applyEdit(we);
  const inlineQuiz = await c.waitQuiz(2500);
  if (inlineQuiz) await c.failQuiz();
  return {
    result: "INFO",
    observed: `scheme=${ed.document.uri.scheme} pasteQuiz=${opened} pasteInserted=${inserted} removedOnFail=${restored} extensionInsertQuiz=${inlineQuiz}`,
  };
}, { needsCdp: true });

test("K6-diff-editor", "Ctrl+V into the modified side of a diff editor", PLAIN, async (c) => {
  const { vscode } = c;
  const left = c.file("k6-left.ts", "const a = 1;\n");
  const original = "const a = 2;\n";
  const right = c.file("k6-right.ts", original);
  await vscode.commands.executeCommand("vscode.diff", left, right, "k6 diff");
  await c.sleep(1200);
  const ed = vscode.window.activeTextEditor;
  if (!ed || ed.document.uri.fsPath !== right.fsPath) {
    return { result: "UNTESTED", observed: "modified side not active: " + (ed ? ed.document.uri.fsPath : "none") };
  }
  c.cursorAtEnd(ed);
  const BIG = c.big("k6");
  await vscode.env.clipboard.writeText(BIG);
  await c.focusEditor();
  await c.cdp.key("ctrl+v");
  const opened = await c.waitQuiz(3000);
  const inserted = ed.document.getText().includes(BIG);
  if (opened) await c.failQuiz();
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === right.fsPath);
  const restored = doc.getText() === original;
  const diffStill = vscode.window.tabGroups.activeTabGroup.activeTab;
  return verdict(opened && inserted && restored, "quiz in diff editor, removed on fail",
    `opened=${opened} inserted=${inserted} removedOnFail=${restored} activeTabAfter=${diffStill && diffStill.label}`);
}, { needsCdp: true });

test("K6b-diff-editor-cmd", "Guard paste command in a diff editor: capture the error", PLAIN, async (c) => {
  const { vscode } = c;
  const left = c.file("k6b-left.ts", "const a = 1;\n");
  const original = "const a = 2;\n";
  const right = c.file("k6b-right.ts", original);
  await vscode.commands.executeCommand("vscode.diff", left, right, "k6b diff");
  await c.sleep(1200);
  const ed = vscode.window.activeTextEditor;
  c.cursorAtEnd(ed);
  await vscode.env.clipboard.writeText(c.big("k6b"));
  let error = "none";
  const p = vscode.commands.executeCommand("comprehensionGuard.paste").then(
    () => "resolved",
    (e) => (error = String(e && e.message ? e.message : e)),
  );
  const opened = await c.waitQuiz(3000);
  const settled = await Promise.race([p, c.sleep(1500).then(() => "pending")]);
  if (opened) await c.failQuiz();
  const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).map((t) => t.label).join(", ");
  return { result: opened ? "PASS" : "BUG", observed: `quiz=${opened} command=${settled} error=${error} tabs=[${tabs}]` };
});

test("K7-multicursor", "Multi-cursor paste (clipboard lines == cursor count)", ALL, async (c) => {
  const { vscode } = c;
  const lines = [0, 1, 2].map((i) => `const value${i} = computeSomethingLong(${i}, "a fairly long argument string here ${i}");`);
  const clip = lines.join("\n");
  // Expected built-in result: one clipboard line per cursor ("spread").
  const original = "a\nb\nc\n";
  const expected = `a${lines[0]}\nb${lines[1]}\nc${lines[2]}\n`;
  const uri = c.file("k7.ts", original);
  const ed = await c.show(uri);
  ed.selections = [0, 1, 2].map((l) => new vscode.Selection(l, 1, l, 1));
  await vscode.env.clipboard.writeText(clip);
  await c.focusEditor();
  if (c.profile === "vim") {
    await vscode.commands.executeCommand("type", { text: "i" }).then(undefined, () => undefined);
  }
  await c.cdp.key("ctrl+v");
  const opened = await c.waitQuiz(3000);
  if (opened) await c.bypassQuiz();
  await c.sleep(300);
  const got = ed.document.getText();
  return verdict(got === expected, "spread paste matches built-in behaviour",
    `quiz=${opened} text after Bypass=${JSON.stringify(got.slice(0, 160))} (built-in would put one line per cursor)`);
}, { needsCdp: true });

test("K8-notebook-cell", "Ctrl+V and extension insertion in a Jupyter notebook cell", PLAIN, async (c) => {
  const { vscode } = c;
  const nbJson = {
    cells: [{ cell_type: "code", source: ["x = 1"], metadata: {}, outputs: [], execution_count: null }],
    metadata: { language_info: { name: "python" } },
    nbformat: 4,
    nbformat_minor: 5,
  };
  const uri = c.file("k8.ipynb", JSON.stringify(nbJson));
  const nb = await vscode.workspace.openNotebookDocument(uri);
  await vscode.window.showNotebookDocument(nb);
  await c.sleep(1000);
  await vscode.commands.executeCommand("notebook.cell.edit").then(undefined, () => undefined);
  await c.sleep(400);
  const cellDoc = nb.cellAt(0).document;
  const ed = vscode.window.activeTextEditor;
  const scheme = ed ? ed.document.uri.scheme : "none";
  if (ed) ed.selection = new vscode.Selection(0, 5, 0, 5);
  const BIG = "\n" + Array.from({ length: 6 }, (_, i) => `def helper_${i}(items):\n    return sum(i * ${i} for i in items)`).join("\n");
  await vscode.env.clipboard.writeText(BIG);
  const focus = await c.activeElementInfo();
  c.lastPasteError = "";
  await c.cdp.key("ctrl+v");
  const opened = await c.waitQuiz(3000);
  await c.sleep(300);
  const pasted = cellDoc.getText().includes("helper_0");
  if (opened) await c.failQuiz();
  await c.sleep(300);
  const afterFail = cellDoc.getText().includes("helper_0");
  // Extension insertion into the cell (AI notebook completion).
  const we = new vscode.WorkspaceEdit();
  we.insert(cellDoc.uri, new vscode.Position(0, 0), BIG.replace(/helper/g, "ai_helper") + "\n");
  await vscode.workspace.applyEdit(we);
  const inlineQuiz = await c.waitQuiz(2500);
  if (inlineQuiz) await c.failQuiz();
  const aiKept = cellDoc.getText().includes("ai_helper_0");
  const pasteNote = `cellScheme=${scheme} focus=${focus} pasteQuiz=${opened} pastedIntoCell=${pasted} afterFail=${afterFail}`;
  return {
    result: !inlineQuiz && aiKept ? "BUG" : "PASS",
    observed: `${pasteNote}; extension insertion of ${BIG.length} chars into cell: quiz=${inlineQuiz} kept=${aiKept}`,
  };
}, { needsCdp: true });

// ======================================== other extensions inserting code
test("D2-multi-edit-shift", "One WorkspaceEdit: small insert above + 300-char insert below, fail", ALL, async (c) => {
  const { vscode } = c;
  const original = "line0\nline1\nline2\n";
  const uri = c.file("d2.ts", original);
  const ed = await c.show(uri);
  const BIG = c.big("d2");
  await vscode.commands.executeCommand("cgHelper.workspaceEdit", {
    uri: uri.toString(),
    edits: [
      { at: { line: 0, character: 0 }, text: "// header added by tool\n" },
      { at: { line: 3, character: 0 }, text: BIG },
    ],
  });
  const opened = await c.waitQuiz();
  await c.failQuiz();
  const after = ed.document.getText();
  return verdict(opened && !after.includes(BIG), "large insertion removed on fail",
    `opened=${opened} bigTextStillInFile=${after.includes(BIG)} (range of contentChange is pre-edit coordinates)`);
});

test("D3-two-big-inserts", "One WorkspaceEdit with two 300-char inserts, fail", ALL, async (c) => {
  const { vscode } = c;
  const original = "line0\nline1\n";
  const uri = c.file("d3.ts", original);
  const ed = await c.show(uri);
  const B1 = c.big("d3a");
  const B2 = c.big("d3b");
  await vscode.commands.executeCommand("cgHelper.workspaceEdit", {
    uri: uri.toString(),
    edits: [
      { at: { line: 0, character: 0 }, text: B1 },
      { at: { line: 2, character: 0 }, text: B2 },
    ],
  });
  const opened = await c.waitQuiz();
  await c.failQuiz();
  await c.sleep(2500);
  const second = c.quizOpen();
  if (second) await c.failQuiz();
  const after = ed.document.getText();
  return verdict(opened && !after.includes(B1) && !after.includes(B2), "both insertions removed",
    `opened=${opened} B1left=${after.includes(B1)} B2left=${after.includes(B2)} secondQuiz=${second}`);
});

test("D4-streamed", "Inline-chat style streaming: 600 chars in 40-char chunks", ALL, async (c) => {
  const { vscode } = c;
  const uri = c.file("d4.ts", "const keep = 4;\n");
  const ed = await c.show(uri);
  const BIG = c.big("d4", 6) + c.big("d4b", 2);
  await vscode.commands.executeCommand("cgHelper.stream", { text: BIG, chunk: 40, delayMs: 25 });
  const opened = await c.waitQuiz(3000);
  if (opened) await c.failQuiz();
  return verdict(opened, "streamed insertion quizzed",
    `quiz=${opened}; ${BIG.length} chars landed unchecked=${ed.document.getText().includes(BIG)}`);
});

test("D5-snippet", "insertSnippet with tab stops (snippet extension), fail", ALL, async (c) => {
  const { vscode } = c;
  const original = "const keep = 5;\n";
  const uri = c.file("d5.ts", original);
  const ed = await c.show(uri);
  c.cursorAtEnd(ed);
  const body = Array.from({ length: 6 }, (_, i) => `export function \${${i + 1}:name${i}}(items: number[]) {\n\treturn items.map((x) => x * ${i});\n}`).join("\n");
  await vscode.commands.executeCommand("cgHelper.snippet", { text: body, at: "end" });
  const opened = await c.waitQuiz();
  await c.failQuiz();
  const after = ed.document.getText();
  return verdict(opened && after === original, "snippet quizzed and removed", `opened=${opened} removedOnFail=${after === original}`);
});

test("D6-inline-completion", "Inline completion (ghost text) accepted via inlineSuggest.commit", ALL, async (c) => {
  const { vscode } = c;
  const original = "const keep = 6;\n";
  const uri = c.file("d6.ts", original);
  const ed = await c.show(uri);
  c.cursorAtEnd(ed);
  const BIG = c.big("d6");
  await c.setConfig("chat.disableAIFeatures", false);
  await c.setConfig("editor.inlineSuggest.enabled", true);
  await c.sleep(500);
  await vscode.commands.executeCommand("cgHelper.setInline", { text: BIG });
  await c.focusEditor();
  if (c.profile === "vim") await vscode.commands.executeCommand("type", { text: "i" }).then(undefined, () => undefined);
  let committed = false;
  for (let i = 0; i < 5 && !committed; i++) {
    if (c.cdp) {
      await c.cdp.typeText(i === 0 ? "\n" : " "); // typing triggers automatic inline suggestions
    }
    await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
    await c.sleep(900);
    if (c.cdp) await c.cdp.key("tab"); // Tab accepts ghost text, like Copilot
    else await vscode.commands.executeCommand("editor.action.inlineSuggest.commit");
    await c.sleep(300);
    committed = ed.document.getText().includes("d6_0") || c.quizOpen();
  }
  await vscode.commands.executeCommand("cgHelper.setInline", { text: "" });
  await c.setConfig("chat.disableAIFeatures", true);
  const calls = await vscode.commands.executeCommand("cgHelper.inlineCalls");
  if (!committed) return { result: "UNTESTED", observed: `ghost text never committed (provider calls=${calls})` };
  const opened = await c.waitQuiz(3000);
  await c.failQuiz();
  const after = ed.document.getText();
  if (c.profile !== "vim") {
    // check the original text survives too
  }
  return verdict(opened && !after.includes("d6_0"), "accepted inline completion quizzed and removed on fail",
    `opened=${opened} stillInFile=${after.includes("d6_0")}`);
});

test("D7-bg-doc-workspaceedit", "Extension edits an open but non-visible document (WorkspaceEdit), fail", ALL, async (c) => {
  const { vscode } = c;
  const original = "export const bg = 7;\n";
  const uri = c.file("d7.ts", original);
  await c.show(uri);
  await c.show(c.file("d7-front.ts", "// front\n"));
  await c.sleep(300);
  const BIG = c.big("d7");
  await vscode.commands.executeCommand("cgHelper.workspaceEdit", { uri: uri.toString(), edits: [{ at: "end", text: BIG }] });
  const opened = await c.waitQuiz(6000);
  await c.failQuiz();
  await c.sleep(600);
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath);
  const bufferClean = doc && doc.getText() === original;
  const disk = c.disk(uri);
  return verdict(opened && bufferClean, "background edit quizzed and reverted",
    `opened=${opened} bufferReverted=${bufferClean} dirty=${doc && doc.isDirty} diskHasCode=${disk.includes(BIG)}`);
});

test("D7b-bg-doc-pass-saves", "Extension edits non-visible doc, pass: does the guard save the file?", ALL, async (c) => {
  const { vscode } = c;
  const original = "export const bg = 77;\n";
  const uri = c.file("d7b.ts", original);
  await c.show(uri);
  await c.show(c.file("d7b-front.ts", "// front\n"));
  await c.sleep(300);
  const BIG = c.big("d7b");
  await vscode.commands.executeCommand("cgHelper.workspaceEdit", { uri: uri.toString(), edits: [{ at: "end", text: BIG }] });
  const opened = await c.waitQuiz(6000);
  const answered = opened ? await c.answerQuiz() : false;
  await c.sleep(600);
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath);
  const disk = c.disk(uri);
  return {
    result: opened && answered && doc.getText().includes(BIG) ? (disk.includes(BIG) ? "INFO" : "PASS") : "BUG",
    observed: `opened=${opened} answered=${answered} bufferHasCode=${doc.getText().includes(BIG)} savedToDiskByGuard=${disk.includes(BIG)} dirty=${doc.isDirty}`,
  };
}, { needsCdp: true });

test("D8-split-visible", "Extension edits a visible but unfocused split editor", ALL, async (c) => {
  const { vscode } = c;
  const original = "export const split = 8;\n";
  const uri = c.file("d8.ts", original);
  await c.show(c.file("d8-left.ts", "// left\n"), { viewColumn: vscode.ViewColumn.One });
  await c.show(uri, { viewColumn: vscode.ViewColumn.Two });
  await c.show(c.file("d8-left.ts", "// left\n"), { viewColumn: vscode.ViewColumn.One });
  await c.sleep(300);
  const BIG = c.big("d8");
  await vscode.commands.executeCommand("cgHelper.workspaceEdit", { uri: uri.toString(), edits: [{ at: "end", text: BIG }] });
  const opened = await c.waitQuiz(4000);
  await c.failQuiz();
  await c.sleep(2500);
  const second = c.quizOpen();
  if (second) await c.failQuiz();
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath);
  return verdict(opened && !second && doc.getText() === original, "one quiz; reverted",
    `opened=${opened} secondQuiz=${second} reverted=${doc.getText() === original}`);
});

test("D9-fswrite-active-clean", "Agent extension writes the active clean file with workspace.fs, fail", ALL, async (c) => {
  const { vscode } = c;
  const original = "export const active = 9;\n";
  const uri = c.file("d9.ts", original);
  const ed = await c.show(uri);
  const BIG = c.big("d9");
  await vscode.commands.executeCommand("cgHelper.fsWrite", { uri: uri.toString(), text: original + BIG });
  const opened = await c.waitQuiz(8000);
  await c.sleep(300);
  const diskDuring = c.disk(uri).includes(BIG);
  await c.failQuiz();
  await c.sleep(1200);
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath);
  const disk = c.disk(uri);
  return verdict(opened && !disk.includes(BIG), "agent code removed from disk after fail",
    `opened=${opened} diskHadCodeDuringQuiz=${diskDuring} diskHasCodeAfterFail=${disk.includes(BIG)} bufferHasCode=${doc && doc.getText().includes(BIG)} dirty=${doc && doc.isDirty}`);
});

test("D10-lock-fight", "Another extension re-applies its edit while the file is locked", ALL, async (c) => {
  const { vscode } = c;
  const uri = c.file("d10.ts", "const keep = 10;\n");
  const ed = await c.show(uri);
  c.cursorAtEnd(ed);
  await vscode.env.clipboard.writeText(c.big("d10"));
  const p = pasteCmd(c);
  const opened = await c.waitQuiz();
  // A "keep header" extension: whenever the doc changes and lacks the header, add it.
  let applied = 0;
  const sub = vscode.workspace.onDidChangeTextDocument(async (e) => {
    if (e.document.uri.fsPath !== uri.fsPath || applied > 200) return;
    if (!e.document.getText().startsWith("// header")) {
      applied++;
      const we = new vscode.WorkspaceEdit();
      we.insert(uri, new vscode.Position(0, 0), "// header\n");
      await vscode.workspace.applyEdit(we);
    }
  });
  const we = new vscode.WorkspaceEdit();
  we.insert(uri, new vscode.Position(0, 0), "// header\n");
  await vscode.workspace.applyEdit(we);
  const counter = c.changeCounter(uri);
  await c.sleep(3000);
  sub.dispose();
  counter.dispose();
  if (opened) await c.bypassQuiz();
  await p.then(undefined, () => undefined);
  return {
    result: counter.events > 40 ? "BUG" : "PASS",
    observed: `quiz=${opened} change events in 3 s while locked=${counter.events} header re-applies=${applied}`,
  };
});

// ============================================ settings: save participants
test("S1-autosave-paste-quiz", "files.autoSave=afterDelay while a pasted block awaits the quiz", ALL, async (c) => {
  const { vscode } = c;
  await c.setConfig("files.autoSave", "afterDelay");
  await c.setConfig("files.autoSaveDelay", 300);
  try {
    const original = "const keep = 11;\n";
    const uri = c.file("s1.ts", original);
    const ed = await c.show(uri);
    c.cursorAtEnd(ed);
    const BIG = c.big("s1");
    await vscode.env.clipboard.writeText(BIG);
    const p = pasteCmd(c);
    const opened = await c.waitQuiz();
    await c.sleep(2000);
    const diskDuring = c.disk(uri).includes(BIG);
    await c.failQuiz();
    await p.then(undefined, () => undefined);
    await c.sleep(1500);
    const diskAfter = c.disk(uri).includes(BIG);
    return verdict(opened && !diskDuring && !diskAfter, "held paste never reached disk",
      `opened=${opened} pasteOnDiskDuringQuiz=${diskDuring} pasteOnDiskAfterFail=${diskAfter}`);
  } finally {
    await c.setConfig("files.autoSave", undefined);
    await c.setConfig("files.autoSaveDelay", undefined);
  }
});

test("S1b-autosave-focus-inline", "files.autoSave=onFocusChange + inline insertion quiz", ALL, async (c) => {
  const { vscode } = c;
  await c.setConfig("files.autoSave", "onFocusChange");
  try {
    const original = "const keep = 111;\n";
    const uri = c.file("s1b.ts", original);
    await c.show(uri);
    const BIG = c.big("s1b");
    await vscode.commands.executeCommand("cgHelper.editorEdit", { text: BIG, at: "end" });
    const opened = await c.waitQuiz();
    await c.sleep(1200);
    const diskDuring = c.disk(uri).includes(BIG);
    await c.failQuiz();
    await c.sleep(1200);
    const diskAfter = c.disk(uri).includes(BIG);
    return verdict(opened && !diskDuring && !diskAfter, "held insertion never reached disk",
      `opened=${opened} onDiskDuringQuiz=${diskDuring} onDiskAfterFail=${diskAfter}`);
  } finally {
    await c.setConfig("files.autoSave", undefined);
  }
});

test("S2-trim-autosave-loop", "trimTrailingWhitespace + autoSave while the file is locked", ALL, async (c) => {
  const { vscode } = c;
  await c.setConfig("files.trimTrailingWhitespace", true);
  await c.setConfig("files.autoSave", "afterDelay");
  await c.setConfig("files.autoSaveDelay", 200);
  try {
    const uri = c.file("s2.ts", "const keep = 12;\n");
    const ed = await c.show(uri);
    c.cursorAtEnd(ed);
    const BIG = c.big("s2").replace(/\n/g, "   \n");
    await vscode.env.clipboard.writeText(BIG);
    const p = pasteCmd(c);
    const opened = await c.waitQuiz();
    const counter = c.changeCounter(uri);
    let saves = 0;
    const sub = vscode.workspace.onDidSaveTextDocument((d) => {
      if (d.uri.fsPath === uri.fsPath) saves++;
    });
    await c.sleep(4000);
    counter.dispose();
    sub.dispose();
    await c.bypassQuiz();
    await p.then(undefined, () => undefined);
    return {
      result: counter.events > 6 || saves > 4 ? "BUG" : "PASS",
      observed: `quiz=${opened} during 4 s of open quiz: change events=${counter.events} saves=${saves}`,
    };
  } finally {
    await c.setConfig("files.trimTrailingWhitespace", undefined);
    await c.setConfig("files.autoSave", undefined);
    await c.setConfig("files.autoSaveDelay", undefined);
  }
});

async function agentRevertWithSaveParticipant(c, name, userCode, setup, teardown, lang = "ts") {
  const { vscode } = c;
  await setup();
  try {
    const uri = c.file(name + "." + lang, userCode);
    await c.show(uri);
    await c.show(c.file(name + "-front." + lang, "// front\n"));
    await c.sleep(400);
    const BIG = c.big(name.replace(/\W/g, "_"));
    fs.writeFileSync(uri.fsPath, userCode + BIG, "utf8");
    const opened = await c.waitQuiz(8000);
    await c.sleep(400);
    const diskDuring = c.disk(uri);
    const userCodeChangedDuring = !diskDuring.startsWith(userCode);
    const answered = opened ? await c.answerQuiz() : false;
    await c.sleep(1500);
    const disk = c.disk(uri);
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath);
    const kept = disk.includes(BIG.split("\n")[0]) || (doc && doc.getText().includes(BIG.split("\n")[0]));
    return verdict(
      opened && answered && kept,
      `agent code written back after pass (user code reformatted during revert=${userCodeChangedDuring})`,
      `opened=${opened} answered=${answered} agentCodeKeptAfterPass=${kept} userCodeReformattedByGuardSave=${userCodeChangedDuring}`,
    );
  } finally {
    await teardown();
  }
}

test("S3-trim-agent-pass", "trimTrailingWhitespace on; agent edit to open file whose user code has trailing spaces; pass", ALL,
  async (c) => agentRevertWithSaveParticipant(
    c,
    "s3",
    "export const total = 1;   \nexport const other = 2;\n",
    () => c.setConfig("files.trimTrailingWhitespace", true),
    () => c.setConfig("files.trimTrailingWhitespace", undefined),
  ), { needsCdp: true });

test("S3b-finalnewline-agent-pass", "insertFinalNewline on; user file without final newline; agent edit; pass", ALL,
  async (c) => agentRevertWithSaveParticipant(
    c,
    "s3b",
    "export const total = 1;\nexport const other = 2;",
    () => c.setConfig("files.insertFinalNewline", true),
    () => c.setConfig("files.insertFinalNewline", undefined),
  ), { needsCdp: true });

test("S4-organize-imports-save", "codeActionsOnSave organizeImports on the user's own imports", ALL, async (c) => {
  const { vscode } = c;
  await c.setConfig("editor.codeActionsOnSave", { "source.organizeImports": "explicit" });
  try {
    const names = ["zeta", "yankee", "xray", "whiskey", "victor", "uniform", "tango", "sierra"];
    const imports = names.map((n) => `import { ${n}Helper } from "./lib/${n}-module-with-a-long-name";`).join("\n");
    const uses = names.map((n) => `${n}Helper();`).join("\n");
    const original = imports + "\n\n" + uses + "\n";
    for (const n of names) c.file(`lib/${n}-module-with-a-long-name.ts`, `export function ${n}Helper() {}\n`);
    const uri = c.file("s4.ts", original);
    const ed = await c.show(uri);
    await c.sleep(4000); // let tsserver start
    const counter = c.changeCounter(uri);
    // make the doc dirty with a tiny user edit, then save
    await ed.edit((b) => b.insert(new vscode.Position(ed.document.lineCount - 1, 0), "\n"));
    await vscode.commands.executeCommand("workbench.action.files.save");
    const opened = await c.waitQuiz(5000);
    counter.dispose();
    if (opened) await c.failQuiz();
    await c.sleep(500);
    const text = ed.document.getText();
    const importsLost = names.some((n) => !text.includes(`import { ${n}Helper }`));
    return {
      result: opened ? "BUG" : "PASS",
      observed: `organizeImports largest change=${counter.maxChange} chars; quiz on user's own imports=${opened}; importsDeletedOnFail=${importsLost}`,
    };
  } finally {
    await c.setConfig("editor.codeActionsOnSave", undefined);
  }
});

test("S5-format-json", "Format Document on a minified JSON file the user already had", ALL, async (c) => {
  const { vscode } = c;
  const obj = {};
  for (let i = 0; i < 20; i++) obj["key" + i] = { value: i, label: "item number " + i };
  const original = JSON.stringify(obj) + "\n";
  const uri = c.file("s5.json", original);
  const ed = await c.show(uri);
  const counter = c.changeCounter(uri);
  await vscode.commands.executeCommand("editor.action.formatDocument");
  const opened = await c.waitQuiz(4000);
  counter.dispose();
  await c.sleep(500);
  const quizzed = opened ? (await c.quizSnippetText()).slice(0, 60) : "";
  const doc0 = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath);
  const linesDuringQuiz = doc0 ? doc0.lineCount : -1;
  const diskDuringQuiz = c.disk(uri).split(/\n/).length - 1;
  if (opened) await c.failQuiz();
  await c.sleep(800);
  const formattingUndone = ed.document.lineCount === 1;
  c.note = `lines during quiz: buffer=${linesDuringQuiz} disk=${diskDuringQuiz}`;
  const disk = c.disk(uri);
  return {
    result: opened ? "BUG" : "PASS",
    observed: `format: ${counter.changesInFirst} changes in first event, largest=${counter.maxChange}, total=${counter.totalInserted}, doc.isDirty in that event=${counter.dirtyAtFirst}; quiz on user's own file=${opened} snippet=${JSON.stringify(quizzed)}; formatting undone on fail=${formattingUndone} savedByGuard=${disk !== original} ${c.note}`,
  };
});

test("S5b-rename-like-clean", "Rename/replace-all style WorkspaceEdit (many small edits) on a clean active file", ALL, async (c) => {
  const { vscode } = c;
  const lines = Array.from({ length: 30 }, (_, i) => `const r${i} = oldName(${i});`);
  const original = lines.join("\n") + "\n";
  const uri = c.file("s5b.ts", original);
  const ed = await c.show(uri);
  const edits = lines.map((_, i) => ({ at: { line: i, character: 11 + String(i).length }, text: "Renamed" }));
  const counter = c.changeCounter(uri);
  await vscode.commands.executeCommand("cgHelper.workspaceEdit", { uri: uri.toString(), edits });
  const opened = await c.waitQuiz(4000);
  counter.dispose();
  await c.sleep(500);
  const doc0 = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath);
  const renamedDuring = doc0 ? doc0.getText().includes("Renamed") : "closed";
  if (opened) await c.failQuiz();
  await c.sleep(800);
  const undone = !ed.document.getText().includes("Renamed");
  c.note = `renameVisibleDuringQuiz=${renamedDuring} diskHasRename=${c.disk(uri).includes("Renamed")}`;
  return {
    result: opened ? "BUG" : "PASS",
    observed: `${counter.changesInFirst} edits of 7 chars (total ${counter.totalInserted}); isDirty in event=${counter.dirtyAtFirst}; quiz=${opened}; rename undone on fail=${undone} ${c.note}`,
  };
});

test("S5c-many-small-dirty", "Same multi-edit on an already dirty active file (AI apply split into small edits)", ALL, async (c) => {
  const { vscode } = c;
  const original = "const keep = 55;\n" + "\n".repeat(10);
  const uri = c.file("s5c.ts", original);
  const ed = await c.show(uri);
  await ed.edit((b) => b.insert(new vscode.Position(0, 0), "// dirty\n"));
  const pieces = Array.from({ length: 10 }, (_, i) => ({ at: { line: 2 + i, character: 0 }, text: `export const gen${i} = (x: number) => x * ${i} + 1;` }));
  await vscode.commands.executeCommand("cgHelper.workspaceEdit", { uri: uri.toString(), edits: pieces });
  const opened = await c.waitQuiz(4000);
  if (opened) await c.failQuiz();
  const kept = ed.document.getText().includes("gen9");
  return verdict(opened, "quizzed", `quiz=${opened}; ${pieces.reduce((n, p) => n + p.text.length, 0)} generated chars landed unchecked=${kept}`);
});

test("S6-formatOnPaste", "editor.formatOnPaste with a large guarded paste", ALL, async (c) => {
  const { vscode } = c;
  await c.setConfig("editor.formatOnPaste", true);
  try {
    const uri = c.file("s6.json", "");
    const ed = await c.show(uri);
    const obj = {};
    for (let i = 0; i < 12; i++) obj["k" + i] = "value number " + i;
    const clip = JSON.stringify(obj);
    await vscode.env.clipboard.writeText(clip);
    const p = pasteCmd(c);
    const opened = await c.waitQuiz();
    if (opened) await c.bypassQuiz();
    await p.then(undefined, () => undefined);
    const guarded = ed.document.getText();
    const formattedGuarded = guarded.split("\n").length > 3;
    // Same paste with the guard off for comparison.
    await c.setConfig("comprehensionGuard.enabled", false);
    const ed2 = await c.show(c.file("s6b.json", ""));
    await vscode.commands.executeCommand("editor.action.clipboardPasteAction");
    await c.sleep(1200);
    const formattedBuiltin = ed2.document.getText().split("\n").length > 3;
    await c.setConfig("comprehensionGuard.enabled", undefined);
    return {
      result: formattedBuiltin && !formattedGuarded ? "INFO" : "PASS",
      observed: `quiz=${opened} formatOnPaste applied: guarded=${formattedGuarded} builtin=${formattedBuiltin}`,
    };
  } finally {
    await c.setConfig("editor.formatOnPaste", undefined);
    await c.setConfig("comprehensionGuard.enabled", undefined);
  }
});

// ================================================== formatters profile
test("F1-prettier-agent-pass", "Prettier formatOnSave; agent edit to open non-Prettier file; pass", FMT,
  async (c) => agentRevertWithSaveParticipant(
    c,
    "f1",
    "export const total = 'single quotes'\nexport function add(a,b){return a+b}\n",
    async () => {
      await c.setConfig("editor.defaultFormatter", "esbenp.prettier-vscode");
      await c.setConfig("editor.formatOnSave", true);
    },
    async () => {
      await c.setConfig("editor.defaultFormatter", undefined);
      await c.setConfig("editor.formatOnSave", undefined);
    },
  ), { needsCdp: true });

test("F2-prettier-format-own-code", "Prettier Format Document on user's own unformatted one-liner", FMT, async (c) => {
  const { vscode } = c;
  await c.setConfig("editor.defaultFormatter", "esbenp.prettier-vscode");
  try {
    const original = Array.from({ length: 6 }, (_, i) => `function f${i}(a,b){ if(a>b){return a-b} else {return b-a} }`).join(" ") + "\n";
    const uri = c.file("f2.ts", original);
    const ed = await c.show(uri);
    await c.sleep(1500);
    const counter = c.changeCounter(uri);
    await vscode.commands.executeCommand("editor.action.formatDocument");
    const opened = await c.waitQuiz(3000);
    counter.dispose();
    const formatted = ed.document.getText() !== original;
    if (opened) await c.failQuiz();
    await c.sleep(400);
    const after = ed.document.getText();
    const lost = !after.includes("f5");
    return {
      result: !formatted ? "UNTESTED" : opened ? "BUG" : "PASS",
      observed: `formatted=${formatted} largest change=${counter.maxChange} quiz on own code=${opened} userCodeDeletedOnFail=${lost}`,
    };
  } finally {
    await c.setConfig("editor.defaultFormatter", undefined);
  }
});

test("F3-prettier-formatOnPaste", "Prettier + formatOnPaste with guarded paste", FMT, async (c) => {
  const { vscode } = c;
  await c.setConfig("editor.defaultFormatter", "esbenp.prettier-vscode");
  await c.setConfig("editor.formatOnPaste", true);
  try {
    const uri = c.file("f3.ts", "");
    const ed = await c.show(uri);
    const clip = Array.from({ length: 5 }, (_, i) => `function g${i}(a,b){return a+b+${i}}`).join("\n") + "\n";
    await vscode.env.clipboard.writeText(clip);
    const p = pasteCmd(c);
    const opened = await c.waitQuiz();
    const counter = c.changeCounter(uri);
    if (opened) await c.bypassQuiz();
    await p.then(undefined, () => undefined);
    await c.sleep(1500);
    counter.dispose();
    const second = c.quizOpen();
    if (second) await c.failQuiz();
    return {
      result: second ? "BUG" : "INFO",
      observed: `quiz=${opened} formatted after bypass=${ed.document.getText() !== clip} second quiz from format=${second}`,
    };
  } finally {
    await c.setConfig("editor.defaultFormatter", undefined);
    await c.setConfig("editor.formatOnPaste", undefined);
  }
});

test("F4-editorconfig-autosave-lock", "EditorConfig trim/final-newline on save + autoSave during paste quiz", FMT, async (c) => {
  const { vscode } = c;
  c.file(".editorconfig", "root = true\n[*]\ntrim_trailing_whitespace = true\ninsert_final_newline = true\n");
  await c.setConfig("files.autoSave", "afterDelay");
  await c.setConfig("files.autoSaveDelay", 200);
  try {
    const uri = c.file("f4.ts", "const keep = 44;\n");
    const ed = await c.show(uri);
    c.cursorAtEnd(ed);
    await vscode.env.clipboard.writeText(c.big("f4").replace(/\n/g, "  \n"));
    const p = pasteCmd(c);
    const opened = await c.waitQuiz();
    const counter = c.changeCounter(uri);
    let saves = 0;
    const sub = vscode.workspace.onDidSaveTextDocument((d) => {
      if (d.uri.fsPath === uri.fsPath) saves++;
    });
    await c.sleep(4000);
    counter.dispose();
    sub.dispose();
    await c.bypassQuiz();
    await p.then(undefined, () => undefined);
    return {
      result: counter.events > 6 || saves > 4 ? "BUG" : "PASS",
      observed: `quiz=${opened} during 4 s: change events=${counter.events} saves=${saves}`,
    };
  } finally {
    fs.rmSync(path.join(c.WS, ".editorconfig"), { force: true });
    await c.setConfig("files.autoSave", undefined);
    await c.setConfig("files.autoSaveDelay", undefined);
  }
});

test("F5-eslint-status", "ESLint extension presence (fix-on-save needs an eslint library)", FMT, async (c) => {
  const ext = c.vscode.extensions.getExtension("dbaeumer.vscode-eslint");
  return {
    result: "UNTESTED",
    observed: `eslint ext ${ext ? ext.packageJSON.version : "missing"}; fix-on-save not exercised: needs the eslint npm package in the workspace (not installed, no approval for npm downloads). Mechanism covered by S4 (codeActionsOnSave).`,
  };
});

test("F6-gitlens-git-docs", "GitLens: open a git: revision diff, guard ignores non-file schemes", FMT, async (c) => {
  const { vscode } = c;
  const uri = c.file("f6.ts", "export const v = 1;\n");
  const cp = require("child_process");
  cp.spawnSync("git", ["add", "f6.ts"], { cwd: c.WS });
  cp.spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "f6"], { cwd: c.WS });
  fs.writeFileSync(uri.fsPath, "export const v = 1;\n" + c.big("f6"), "utf8");
  await c.show(uri);
  await c.sleep(1500);
  const quizFromChange = await c.waitQuiz(3000);
  if (quizFromChange) await c.failQuiz();
  await vscode.commands.executeCommand("git.openChange").then(undefined, () => undefined);
  await c.sleep(2000);
  const quizFromDiff = c.quizOpen();
  const gitlens = vscode.extensions.getExtension("eamodio.gitlens");
  return {
    result: quizFromDiff ? "BUG" : "INFO",
    observed: `gitlens active=${gitlens && gitlens.isActive}; quiz when opening active file changed on disk=${quizFromChange}; extra quiz from opening git diff=${quizFromDiff}`,
  };
});

// ========================================================== Vim profile
test("V1-vim-insert-ctrlv", "VSCodeVim insert mode: Ctrl+V with large clipboard", VIM, async (c) => {
  const { vscode } = c;
  const original = "const keep = 91;\n";
  const uri = c.file("v1.ts", original);
  const ed = await c.show(uri);
  c.cursorAtEnd(ed);
  await c.focusEditor();
  await vscode.commands.executeCommand("type", { text: "i" });
  await c.sleep(200);
  const BIG = c.big("v1");
  await vscode.env.clipboard.writeText(BIG);
  await c.cdp.key("ctrl+v");
  const opened = await c.waitQuiz(3000);
  const inserted = ed.document.getText().includes(BIG);
  if (opened) await c.failQuiz();
  await c.sleep(300);
  const after = ed.document.getText();
  return {
    result: inserted && !opened ? "BUG" : opened ? "PASS" : "INFO",
    observed: `quiz=${opened} pasted=${inserted} removedOnFail=${after === original}`,
  };
}, { needsCdp: true });

test("V2-vim-p-register", "VSCodeVim normal-mode p with vim.useSystemClipboard", VIM, async (c) => {
  const { vscode } = c;
  await c.setConfig("vim.useSystemClipboard", true);
  try {
    const original = "const keep = 92;\n";
    const uri = c.file("v2.ts", original);
    const ed = await c.show(uri);
    ed.selection = new vscode.Selection(0, 0, 0, 0);
    await c.focusEditor();
    const BIG = c.big("v2");
    await vscode.env.clipboard.writeText(BIG);
    await vscode.commands.executeCommand("extension.vim_escape").then(undefined, () => undefined);
    await vscode.commands.executeCommand("type", { text: "p" });
    const opened = await c.waitQuiz(3000);
    const inserted = ed.document.getText().includes("v2_0");
    if (opened) await c.failQuiz();
    await c.sleep(400);
    const after = ed.document.getText();
    // Is Vim still usable afterwards? 'x' should delete one char.
    await c.show(uri);
    await c.focusEditor();
    const before = ed.document.getText();
    await vscode.commands.executeCommand("type", { text: "x" });
    await c.sleep(300);
    const vimWorks = ed.document.getText().length === before.length - 1;
    return {
      result: inserted && !opened ? "BUG" : opened && !after.includes("v2_0") ? "PASS" : "BUG",
      observed: `pasted=${inserted} quiz=${opened} removedOnFail=${!after.includes("v2_0")} vimStillResponds=${vimWorks}`,
    };
  } finally {
    await c.setConfig("vim.useSystemClipboard", undefined);
  }
});

test("V3-vim-guard-paste-cmd", "Guard paste command while Vim is in normal mode, then Bypass", VIM, async (c) => {
  const { vscode } = c;
  const uri = c.file("v3.ts", "const keep = 93;\n");
  const ed = await c.show(uri);
  c.cursorAtEnd(ed);
  const BIG = c.big("v3");
  await vscode.env.clipboard.writeText(BIG);
  const p = pasteCmd(c);
  const opened = await c.waitQuiz();
  await c.bypassQuiz();
  await p.then(undefined, () => undefined);
  await c.show(uri);
  await c.focusEditor();
  const len = ed.document.getText().length;
  await vscode.commands.executeCommand("type", { text: "x" });
  await c.sleep(300);
  const vimMode = ed.document.getText().length === len - 1 ? "normal (x deleted a char)" : "not normal (x typed or ignored)";
  return { result: opened ? "PASS" : "BUG", observed: `quiz=${opened} kept=${ed.document.getText().includes("v3_0")} vim after=${vimMode}` };
});

module.exports = { tests };
