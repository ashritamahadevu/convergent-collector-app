// End-to-end network-failure scenarios, run INSIDE a real VS Code extension
// host (launched by test/e2e/run.mjs with a throwaway profile).
//
// The extension calls the global fetch. This suite wraps globalThis.fetch in
// the same extension host so requests for 127.0.0.1:11434 (provider=ollama)
// go to a mock server or a closed port instead. The real Ollama that runs on
// :11434 on this machine is never contacted.
//
// The webview itself cannot be clicked from here, so these scenarios cover the
// generation phase, the file lock, held code, the Bypass command and closing
// the quiz tab. Grading-phase behaviour is covered by test/network/*.test.ts.

const vscode = require("vscode");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const OLLAMA = "http://127.0.0.1:11434";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SNIPPET = [
  "function total(items) {",
  "  let acc = 0;",
  "  for (const item of items) {",
  "    acc += item;",
  "  }",
  "  return acc;",
  "}",
  "// padding so the snippet is above the default 200 character threshold.......",
  "module.exports = { total };",
  "",
].join("\n");

const QUESTION = {
  kind: "free-text",
  question: "What does total([1,2,3]) return?",
  referenceAnswer: "6",
  criteria: [
    { id: "c1", text: "States the result is 6.", hint: "Look at the loop.", critical: true },
    { id: "c2", text: "Says items are summed.", hint: "Look at acc.", critical: false },
  ],
  conceptTags: ["control-flow"],
  flagged: false,
};

async function waitFor(pred, ms, step = 50) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await pred()) {
      return true;
    }
    await sleep(step);
  }
  return !!(await pred());
}

function quizTabs() {
  return vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter((t) => t.input instanceof vscode.TabInputWebview && /comprehensionGuard\.quiz/.test(t.input.viewType));
}

async function closeQuizTabs() {
  for (const tab of quizTabs()) {
    await vscode.window.tabGroups.close(tab);
  }
}

async function closedPort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return port;
}

/** Applies a WorkspaceEdit (works even when the editor is hidden behind the quiz). */
async function tryInsert(doc, text) {
  const edit = new vscode.WorkspaceEdit();
  edit.insert(doc.uri, new vscode.Position(0, 0), text);
  await vscode.workspace.applyEdit(edit);
  await sleep(600);
  return doc.getText().includes(text);
}

async function run() {
  const results = [];
  const record = (scenario, check, expected, actual, note) => {
    results.push({ scenario, check, expected, actual, ok: expected === actual, note });
  };

  // Mock "Ollama" and fetch redirect.
  let mode = "refused";
  const hung = [];
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push({ at: Date.now(), kind: body.includes("Generate ONE") ? "generate" : "other" });
      if (mode === "hang") {
        hung.push(res);
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: { content: JSON.stringify(QUESTION) } }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const mockBase = "http://127.0.0.1:" + server.address().port;
  const deadBase = "http://127.0.0.1:" + (await closedPort());
  const realFetch = globalThis.fetch;
  const fetchLog = [];
  globalThis.fetch = (input, init) => {
    let url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith(OLLAMA)) {
      url = (mode === "refused" ? deadBase : mockBase) + url.slice(OLLAMA.length);
    }
    fetchLog.push(url);
    if (/:11434(\/|$)/.test(url)) {
      return Promise.reject(new Error("e2e refused to contact the real Ollama"));
    }
    return realFetch(url, init);
  };
  const release = () => {
    for (const res of hung.splice(0)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: { content: JSON.stringify(QUESTION) } }));
    }
  };

  const ext = vscode.extensions.all.find((e) => e.packageJSON && e.packageJSON.name === "comprehension-guard");
  await ext.activate();
  await sleep(500);

  const ws = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const file = (name) => path.join(ws, name);
  const config = vscode.workspace.getConfiguration("comprehensionGuard");
  results.push({ scenario: "setup", check: "provider", expected: "ollama", actual: config.get("provider"), ok: config.get("provider") === "ollama" });

  async function openAtEnd(name) {
    const doc = await vscode.workspace.openTextDocument(file(name));
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const end = doc.lineAt(doc.lineCount - 1).range.end;
    editor.selection = new vscode.Selection(end, end);
    return { doc, editor };
  }

  // ---------------------------------------------------------------- A
  try {
    const S = "A paste, network down (connection refused)";
    mode = "refused";
    const { doc } = await openAtEnd("a.js");
    await vscode.env.clipboard.writeText(SNIPPET);
    const t0 = Date.now();
    let settled = false;
    const p = Promise.resolve(vscode.commands.executeCommand("comprehensionGuard.paste")).then(() => (settled = true));
    const opened = await waitFor(() => quizTabs().length > 0, 8000);
    record(S, "fallback quiz tab opens", true, opened, "after " + (Date.now() - t0) + "ms");
    record(S, "pasted code is in the buffer (held)", true, doc.getText().includes("function total"));
    record(S, "file is locked (edit reverted)", false, await tryInsert(doc, "/*LOCK-A*/"));
    await vscode.commands.executeCommand("comprehensionGuard.bypassNext");
    await waitFor(() => settled, 5000);
    record(S, "Bypass command ends the quiz", true, settled);
    record(S, "quiz tab closed", 0, quizTabs().length);
    record(S, "code kept after Bypass", true, doc.getText().includes("function total"));
    record(S, "file unlocked after Bypass", true, await tryInsert(doc, "/*AFTER-A*/"));
    await p;
  } catch (err) {
    results.push({ scenario: "A", check: "no exception", ok: false, actual: String(err && err.stack) });
  }

  // ---------------------------------------------------------------- B
  try {
    const S = "B paste, provider accepts but never answers (generation hang)";
    mode = "hang";
    requests.length = 0;
    const { doc } = await openAtEnd("b.js");
    await vscode.env.clipboard.writeText(SNIPPET);
    let settled = false;
    const p = Promise.resolve(vscode.commands.executeCommand("comprehensionGuard.paste")).then(() => (settled = true));
    await waitFor(() => requests.length > 0, 5000);
    await sleep(3000);
    record(S, "no quiz tab while generating (nothing to answer, close, or click Bypass on)", 0, quizTabs().length);
    record(S, "pasted code is in the buffer", true, doc.getText().includes("function total"));
    record(S, "file is locked during generation", false, await tryInsert(doc, "/*LOCK-B*/"));
    const before = doc.getText();
    await vscode.env.clipboard.writeText("// second paste " + "y".repeat(250));
    await vscode.commands.executeCommand("comprehensionGuard.paste");
    await sleep(300);
    record(S, "a second paste is refused while generating", true, doc.getText() === before);
    await vscode.env.clipboard.writeText(SNIPPET);
    await vscode.commands.executeCommand("comprehensionGuard.bypassNext");
    await sleep(2000);
    record(S, "Bypass command during generation ends the hold", true, settled, "false = BUG: hold continues");
    record(S, "file editable 2s after Bypass", true, await tryInsert(doc, "/*LOCK-B2*/"), "false = BUG: still locked");
    release();
    const opened = await waitFor(() => quizTabs().length > 0, 8000);
    record(S, "quiz tab opens once the provider answers", true, opened);
    await sleep(1500);
    record(S, "after it opens, the quiz ends by itself (Bypass was already requested)", true, settled, "false = BUG: user must act again");
    await closeQuizTabs();
    await waitFor(() => settled, 5000);
    record(S, "closing the tab now ends the quiz", true, settled);
    record(S, "code kept (closing counted as the earlier Bypass)", true, doc.getText().includes("function total"));
    await p;
  } catch (err) {
    results.push({ scenario: "B", check: "no exception", ok: false, actual: String(err && err.stack) });
  }

  // ---------------------------------------------------------------- C
  try {
    const S = "C agent/disk edit, generation hang, Bypass command";
    mode = "hang";
    requests.length = 0;
    const target = file("c.js");
    const original = fs.readFileSync(target, "utf8");
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target), { preview: false });
    await openAtEnd("d.js"); // c.js stays open in a background tab
    await sleep(800);
    fs.writeFileSync(target, original + "\n" + SNIPPET, "utf8"); // "agent" writes the file
    const started = await waitFor(() => requests.length > 0, 10000);
    record(S, "guard picked up the external write (generation requested)", true, started);
    await sleep(1500);
    record(S, "generated code withheld from disk during the check", true, fs.readFileSync(target, "utf8") === original);
    record(S, "no quiz tab while generating", 0, quizTabs().length);
    await vscode.commands.executeCommand("comprehensionGuard.bypassNext");
    await sleep(1000);
    release();
    const opened = await waitFor(() => quizTabs().length > 0, 8000);
    record(S, "quiz tab opens after the provider answers", true, opened);
    await sleep(1500);
    record(S, "quiz closed by the earlier Bypass command", 0, quizTabs().length, "1 = BUG: Bypass ignored for agent quiz");
    await closeQuizTabs();
    await sleep(2000);
    const after = fs.readFileSync(target, "utf8");
    record(S, "agent code written after Bypass", true, after.includes("function total"), "false = BUG: Bypass was run but the agent code was discarded");

    // Leak: the Bypass command armed a one-shot bypass instead.
    const S2 = "C2 armed bypass leaks to the next insertion";
    mode = "refused";
    requests.length = 0;
    const { doc } = await openAtEnd("e.js");
    await vscode.env.clipboard.writeText(SNIPPET);
    await vscode.commands.executeCommand("comprehensionGuard.paste");
    await sleep(1500);
    record(S2, "next unrelated paste is quizzed (fallback tab opens)", 1, quizTabs().length, "0 = BUG: the earlier Bypass was spent here");
    record(S2, "next paste inserted", true, doc.getText().includes("function total"));
    await closeQuizTabs();
  } catch (err) {
    results.push({ scenario: "C", check: "no exception", ok: false, actual: String(err && err.stack) });
  }

  globalThis.fetch = realFetch;
  release();
  server.close();
  results.push({ scenario: "meta", check: "fetch urls", actual: [...new Set(fetchLog.map((u) => u.replace(/:\d+/, ":PORT")))] });
  fs.writeFileSync(process.env.E2E_RESULTS, JSON.stringify(results, null, 2));
}

module.exports = { run };
