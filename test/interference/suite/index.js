// Interference suite. Runs inside the extension host of a throwaway VS Code
// window. Every test records what it observed; a row is BUG when the guard is
// bypassed, triggers on code that is not new, corrupts a file, or loops.
const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const cdpLib = require("./cdp");
const { tests } = require("./tests");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, ms = 5000, step = 50) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      // keep polling
    }
    if (Date.now() > end) return undefined;
    await sleep(step);
  }
}

function allTabs() {
  return vscode.window.tabGroups.all.flatMap((g) => g.tabs);
}
function quizTabs() {
  return allTabs().filter((t) => t.label === "Comprehension check");
}
const quizOpen = () => quizTabs().length > 0;

function makeCtx(cdp) {
  const WS = process.env.CG_WS;
  const ctx = {
    vscode,
    cdp,
    WS,
    profile: process.env.CG_PROFILE,
    sleep,
    waitFor,
    quizOpen,
    quizCount: () => quizTabs().length,
    file(name, content) {
      const p = path.join(WS, name);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content, "utf8");
      return vscode.Uri.file(p);
    },
    disk(uri) {
      return fs.readFileSync(uri.fsPath, "utf8");
    },
    async show(uri, opts = {}) {
      const doc = await vscode.workspace.openTextDocument(uri);
      return vscode.window.showTextDocument(doc, { preview: false, ...opts });
    },
    cursorAtEnd(editor) {
      const end = editor.document.positionAt(editor.document.getText().length);
      editor.selection = new vscode.Selection(end, end);
    },
    async focusEditor() {
      await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
      await sleep(150);
    },
    async waitQuiz(ms = 6000) {
      return !!(await waitFor(quizOpen, ms));
    },
    async failQuiz() {
      const tabs = quizTabs();
      if (tabs.length) await vscode.window.tabGroups.close(tabs);
      await waitFor(() => !quizOpen(), 3000);
      await sleep(500);
    },
    async bypassQuiz() {
      await vscode.commands.executeCommand("comprehensionGuard.bypassNext");
      await waitFor(() => !quizOpen(), 3000);
      await sleep(500);
    },
    /** Answers the no-API-key fallback quiz in the webview (a genuine pass). */
    async answerQuiz(answer = "It adds the generated helper that totals the order lines.") {
      const expr = `(() => {
        const ta = document.getElementById("answer-input");
        const btn = document.getElementById("submit-btn");
        if (!ta || !btn) return false;
        ta.value = ${JSON.stringify(answer)};
        btn.click();
        return true;
      })()`;
      const ok = await waitFor(() => cdp && cdp.evalInWebviews(expr), 6000, 200);
      await waitFor(() => !quizOpen(), 5000);
      await sleep(700);
      return !!ok;
    },
    async setConfig(key, value, lang) {
      const section = vscode.workspace.getConfiguration(undefined, lang ? { languageId: lang } : undefined);
      await section.update(key, value, vscode.ConfigurationTarget.Global, lang ? true : undefined);
    },
    /** Text of the guard's status bar item ("Guard: On" / "Guard: Quiz open" / ...). */
    async guardStatus() {
      if (!cdp) return "";
      return cdp.evalMain(`(() => {
        const items = [...document.querySelectorAll(".statusbar-item")].map((e) => (e.textContent || "").trim());
        return items.filter((t) => t.includes("Guard:")).join(" | ") || "(no guard item)";
      })()`);
    },
    /** The guard's own state says a quiz is open but no quiz tab exists. */
    async guardWedged() {
      const s = await ctx.guardStatus().catch(() => "");
      return /Guard: Quiz open/.test(s) && !quizOpen();
    },
    async activeElementInfo() {
      if (!cdp) return "";
      return cdp.evalMain(`(() => {
        const a = document.activeElement;
        if (!a) return "none";
        const where = [
          [".scm-editor, .scm-view", "scm"],
          [".repl-input-wrapper, .repl", "repl"],
          [".terminal", "terminal"],
          [".notebook-editor, .cell-editor-container", "notebook"],
          [".diff-editor, .monaco-diff-editor", "diff"],
          [".editor-instance", "editor"],
          [".quick-input-widget", "quickinput"],
        ].filter(([sel]) => a.closest(sel)).map(([, n]) => n);
        return (where.join("+") || "other") + ":" + (a.tagName + "." + String(a.className || "")).slice(0, 40);
      })()`);
    },
    /** Snippet text shown in the open quiz webview (what the guard is quizzing). */
    async quizSnippetText() {
      if (!cdp) return "";
      return (await cdp.evalInWebviews(`(() => { const e = document.querySelector("pre code"); return e ? e.textContent : ""; })()`)) || "";
    },
    changeCounter(uri) {
      const counts = { events: 0, maxChange: 0, totalInserted: 0, changesInFirst: 0, dirtyAtFirst: undefined, reasons: [] };
      const d = vscode.workspace.onDidChangeTextDocument((e) => {
        if (uri && e.document.uri.toString() !== uri.toString()) return;
        if (e.contentChanges.length === 0) return;
        if (counts.events === 0) {
          counts.dirtyAtFirst = e.document.isDirty;
          counts.changesInFirst = e.contentChanges.length;
        }
        counts.events += 1;
        for (const c of e.contentChanges) {
          counts.maxChange = Math.max(counts.maxChange, c.text.length);
          counts.totalInserted += c.text.length;
        }
      });
      counts.dispose = () => d.dispose();
      return counts;
    },
    async cleanup() {
      if (quizOpen()) await ctx.failQuiz();
      await vscode.commands.executeCommand("workbench.action.closePanel");
      for (let i = 0; i < 40 && allTabs().length > 0; i++) {
        const tab = allTabs()[0];
        try {
          if (tab.isDirty) {
            if (tab.input instanceof vscode.TabInputText) {
              await vscode.window.showTextDocument(tab.input.uri, { preview: false, viewColumn: tab.group.viewColumn });
            } else if (tab.input instanceof vscode.TabInputNotebook) {
              const nb = await vscode.workspace.openNotebookDocument(tab.input.uri);
              await vscode.window.showNotebookDocument(nb, { viewColumn: tab.group.viewColumn });
            } else if (tab.input instanceof vscode.TabInputTextDiff) {
              await vscode.commands.executeCommand("vscode.diff", tab.input.original, tab.input.modified);
            }
            await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
          } else {
            await vscode.window.tabGroups.close(tab);
          }
        } catch {
          await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
        }
        await sleep(50);
      }
      // Let gate claims (1.5 s) and editor-gate coverage (3 s) expire.
      await sleep(3200);
      await ctx.resetGuardFlags();
    },
    /**
     * A failed inline quiz can leave state.suppressEditGuard stuck at true
     * (editGuard.ts finally block does not reset it). A short guarded paste
     * goes through withoutEditGuard(), which clears it, so later tests start
     * from a clean guard.
     */
    async resetGuardFlags() {
      const doc = await vscode.workspace.openTextDocument({ content: "" });
      await vscode.window.showTextDocument(doc);
      await vscode.env.clipboard.writeText("x");
      await vscode.commands.executeCommand("comprehensionGuard.paste");
      await sleep(250);
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
      await sleep(100);
    },
  };
  return ctx;
}

function big(tag, lines = 9) {
  const out = [];
  for (let i = 0; i < lines; i++) {
    out.push(`export function ${tag}_${i}(items: number[]): number { return items.reduce((a, b) => a + b * ${i + 2}, 0); }`);
  }
  return out.join("\n") + "\n";
}

async function run() {
  let previous = { results: [], launches: 0 };
  if (process.env.CG_APPEND === "1" && fs.existsSync(process.env.CG_RESULTS)) {
    previous = JSON.parse(fs.readFileSync(process.env.CG_RESULTS, "utf8"));
  }
  const results = previous.results;
  const finished = new Set(results.map((r) => r.id));
  let wedgedAfter = "";
  const only = (process.env.CG_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
  let cdp;
  let cdpError = "";
  try {
    cdp = await cdpLib.connect(Number(process.env.CG_CDP_PORT));
  } catch (err) {
    cdpError = String(err && err.message ? err.message : err);
  }
  const ctx = makeCtx(cdp);
  ctx.big = big;
  // Let the guard and helper (onStartupFinished) activate.
  await vscode.extensions.getExtension("comprehension-guard.comprehension-guard")?.activate();
  await vscode.extensions.getExtension("cgtest.cg-test-helper")?.activate();
  await sleep(2500);

  const record = (row) => {
    results.push(row);
    console.log(`[cg-test] ${row.result} ${row.id}: ${row.observed} [status ${row.statusBefore || "?"} -> ${row.statusAfter || "?"}]`);
  };

  for (const t of tests) {
    if (!t.profiles.includes(ctx.profile)) continue;
    if (only.length && !only.includes(t.id)) continue;
    if (finished.has(t.id)) continue;
    if (wedgedAfter) break;
    const started = Date.now();
    try {
      if (t.needsCdp && !cdp) {
        record({ id: t.id, scenario: t.name, result: "UNTESTED", observed: "CDP unavailable: " + cdpError });
        continue;
      }
      const statusBefore = await ctx.guardStatus().catch(() => "");
      const row = await Promise.race([
        t.fn(ctx),
        sleep(t.timeout || 60000).then(() => ({ result: "ERROR", observed: "test timed out" })),
      ]);
      const statusAfter = await ctx.guardStatus().catch(() => "");
      record({ id: t.id, scenario: t.name, ms: Date.now() - started, statusBefore, statusAfter, ...row });
    } catch (err) {
      record({ id: t.id, scenario: t.name, result: "ERROR", observed: String(err && err.stack ? err.stack : err) });
    } finally {
      try {
        await ctx.cleanup();
      } catch {
        // ignore
      }
      if (await ctx.guardWedged()) {
        // The guard thinks a quiz is open forever: every later paste is refused
        // and the inline / disk guards are off. Stop; the runner relaunches.
        wedgedAfter = t.id;
        const row = results.find((r) => r.id === t.id);
        if (row) {
          row.wedgedGuard = true;
          row.observed += " | GUARD WEDGED afterwards: status 'Quiz open' with no quiz; Ctrl+V refused until window reload";
          if (row.result === "PASS" || row.result === "INFO") row.result = "BUG";
        }
        console.log(`[cg-test] guard wedged after ${t.id}; stopping this launch`);
      }
    }
  }

  const exts = vscode.extensions.all
    .filter((e) => !e.id.startsWith("vscode.") && !e.packageJSON.isBuiltin)
    .map((e) => e.id + "@" + e.packageJSON.version);
  fs.writeFileSync(
    process.env.CG_RESULTS,
    JSON.stringify(
      {
        profile: ctx.profile,
        vscodeVersion: vscode.version,
        extensions: exts,
        installed: process.env.CG_EXT_VERSIONS,
        cdp: cdp ? "connected" : "unavailable: " + cdpError,
        launches: (previous.launches || 0) + 1,
        done: !wedgedAfter,
        wedgedAfter: [...(previous.wedgedAfter || []), ...(wedgedAfter ? [wedgedAfter] : [])],
        results,
      },
      null,
      2,
    ),
  );
  if (cdp) cdp.close();
}

module.exports = { run };
