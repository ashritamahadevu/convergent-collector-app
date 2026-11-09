"use strict";

/**
 * Runs INSIDE the VS Code extension host (loaded by @vscode/test-electron).
 * Stubs toasts, the quiz webview, and fetch (LLM), then feeds agent edits to
 * the real extension through hook/notify.js exactly like Claude Code does
 * (PreToolUse -> write file -> PostToolUse), and records what happens.
 *
 * Env: CG_E2E_PHASE, CG_E2E_OUT, CG_E2E_WS, CG_NODE, COMPREHENSION_GUARD_HOME
 */

const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vscode = require("vscode");

const REPO = path.resolve(__dirname, "..", "..");
const NOTIFY = path.join(REPO, "hook", "notify.js");
const PHASE = process.env.CG_E2E_PHASE || "main";
const OUT = process.env.CG_E2E_OUT;
const WS = process.env.CG_E2E_WS;
const HOME = process.env.COMPREHENSION_GUARD_HOME;
const NODE = process.env.CG_NODE || "node";
const EXT_ID = "comprehension-guard.comprehension-guard";
const FIX = path.join(REPO, "test", "fixtures", "claude-code", "2.1.316");

const extActiveAtLoad = !!vscode.extensions.getExtension(EXT_ID)?.isActive;
const results = [];
const timeline = [];
const note = (what, data) => timeline.push({ t: Date.now(), what, ...(data || {}) });

// ---------- stubs ----------
const llm = require(path.join(REPO, "test", "walkthrough", "mock-llm.cjs"));
llm.install();

if (PHASE === "resume-expired") {
  const realNow = Date.now.bind(Date);
  Date.now = () => realNow() + 9 * 60 * 60 * 1000; // past "Later today" (8h)
}

const infos = [];
let infoHandler = () => undefined;
vscode.window.showInformationMessage = function (message, ...items) {
  const strings = items.filter((i) => typeof i === "string");
  infos.push({ t: Date.now(), message, items: strings });
  note("info", { message });
  return Promise.resolve(infoHandler(message, strings));
};
const warnings = [];
vscode.window.showWarningMessage = function (message) {
  warnings.push({ t: Date.now(), message });
  note("warning", { message });
  return Promise.resolve(undefined);
};
const statuses = [];
const realStatus = vscode.window.setStatusBarMessage.bind(vscode.window);
vscode.window.setStatusBarMessage = function (message, ...rest) {
  statuses.push({ t: Date.now(), message });
  return realStatus(message, ...rest);
};

const panels = [];
let quizPolicy = () => ({ type: "close" });
vscode.window.createWebviewPanel = function (viewType, title) {
  const receive = new vscode.EventEmitter();
  const disposed = new vscode.EventEmitter();
  const rec = { t: Date.now(), viewType, title, questions: [], disposed: false, feedback: [] };
  const panel = {
    viewType,
    title,
    visible: true,
    active: true,
    viewColumn: 1,
    options: {},
    webview: {
      html: "",
      options: {},
      cspSource: "vscode-webview:",
      asWebviewUri: (u) => u,
      onDidReceiveMessage: receive.event,
      postMessage: async (msg) => {
        if (msg && msg.type === "showFeedback") {
          rec.feedback.push(msg.message);
        }
        if (msg && msg.type === "showQuestion") {
          const index = rec.questions.length;
          rec.questions.push(msg.kind);
          note("question", { kind: msg.kind, panel: panels.indexOf(rec) });
          Promise.resolve(quizPolicy(msg, rec, index)).then((action) => {
            setTimeout(() => {
              if (rec.disposed) {
                return;
              }
              if (!action || action.type === "close") {
                panel.dispose();
              } else {
                receive.fire(action);
              }
            }, 5);
          });
        }
        return true;
      },
    },
    onDidDispose: disposed.event,
    onDidChangeViewState: () => ({ dispose() {} }),
    reveal() {},
    dispose() {
      if (rec.disposed) {
        return;
      }
      rec.disposed = true;
      note("panel-closed", { panel: panels.indexOf(rec) });
      disposed.fire();
    },
  };
  panels.push(rec);
  note("panel-open", { panel: panels.length - 1 });
  setTimeout(() => receive.fire({ type: "ready" }), 5);
  return panel;
};

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) {
      return v;
    }
    await sleep(step);
  }
  return undefined;
}
const read = (abs) => {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return undefined;
  }
};
function correct(msg) {
  if (msg.kind === "multiple-choice") {
    return { type: "submit", selectedIndex: 1 };
  }
  if (msg.kind === "ordering") {
    return { type: "submit", order: [1, 0, 2] };
  }
  return { type: "submit", answer: "GOOD it handles the main case and returns the result" };
}
function wrong(msg) {
  if (msg.kind === "multiple-choice") {
    return { type: "submit", selectedIndex: 0 };
  }
  if (msg.kind === "ordering") {
    return { type: "submit", order: [2, 1, 0] };
  }
  return { type: "submit", answer: "something unrelated about the weather today" };
}
async function setMode(mode) {
  await vscode.workspace.getConfiguration("comprehensionGuard").update("mode", mode, vscode.ConfigurationTarget.Global);
  await sleep(200);
}
async function resetEditors() {
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  await sleep(300);
}
function record(id, scenario, expected, observed, verdict, extra) {
  results.push({ id, scenario, expected, observed, verdict, ...(extra || {}) });
  note("result", { id, verdict });
}
async function idle(ms = 2500) {
  // Wait until no panel is open and nothing new happened for a while.
  let last = timeline.length;
  let quietSince = Date.now();
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    await sleep(200);
    if (timeline.length !== last) {
      last = timeline.length;
      quietSince = Date.now();
    }
    if (panels.every((p) => p.disposed) && Date.now() - quietSince > ms) {
      return;
    }
  }
}

let seq = 0;
function base(tool) {
  return {
    session_id: "e2e-session",
    transcript_path: path.join(os.tmpdir(), "none.jsonl"),
    cwd: WS,
    permission_mode: "acceptEdits",
    tool_name: tool,
    tool_use_id: "toolu_e2e_" + ++seq,
  };
}
function hook(payload, home = HOME) {
  return new Promise((resolve) => {
    const child = cp.spawn(NODE, [NOTIFY], {
      env: { ...process.env, COMPREHENSION_GUARD_HOME: home },
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
    child.stdin.end(JSON.stringify(payload));
  });
}
/** Same order and payload shape as a real Claude Code Write (see fixtures). */
async function claudeWritePre(abs, content) {
  const b = base("Write");
  const existed = fs.existsSync(abs);
  const originalFile = existed ? fs.readFileSync(abs, "utf8") : null;
  await hook({ ...b, hook_event_name: "PreToolUse", tool_input: { file_path: abs, content } });
  return { b, existed, originalFile, abs, content };
}
function claudeWriteDisk(w) {
  fs.mkdirSync(path.dirname(w.abs), { recursive: true });
  fs.writeFileSync(w.abs, w.content);
}
function claudeWritePost(w) {
  return hook({
    ...w.b,
    hook_event_name: "PostToolUse",
    tool_input: { file_path: w.abs, content: w.content },
    tool_response: {
      type: w.existed ? "update" : "create",
      filePath: w.abs,
      content: w.content,
      structuredPatch: [],
      originalFile: w.originalFile,
      userModified: false,
    },
    duration_ms: 3,
  });
}
async function claudeWrite(abs, content) {
  const w = await claudeWritePre(abs, content);
  claudeWriteDisk(w);
  await claudeWritePost(w);
}
/** Several Writes whose PostToolUse events land within the 700ms batch window. */
async function claudeWriteBatch(items) {
  const ws = [];
  for (const [abs, content] of items) {
    ws.push(await claudeWritePre(abs, content));
  }
  ws.forEach(claudeWriteDisk);
  await Promise.all(ws.map(claudeWritePost));
}
function code(name, lines) {
  const out = [`// ${name}: generated by the agent`, `function ${name}(input) {`];
  for (let i = 0; out.length < lines - 2; i++) {
    out.push(`  if (input === ${i}) { return input * ${i + 2}; } // case ${i}`);
  }
  out.push("  return input;", "}");
  return out.join("\n") + "\n";
}

/** Materialize a captured fixture into the workspace under `dir`. */
function fixture(name, dir) {
  const project = path.join(WS, dir);
  const raw = fs.readFileSync(path.join(FIX, name + ".json"), "utf8");
  const json = raw.split("__PROJECT__").join(project.replace(/\\/g, "\\\\")).split("__GUARD_HOME__").join(HOME.replace(/\\/g, "\\\\"));
  const f = JSON.parse(json);
  for (const [rel, text] of Object.entries(f.seed)) {
    fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true });
    fs.writeFileSync(path.join(project, rel), text);
  }
  return { f, project };
}

function openDocText(abs) {
  const want = path.resolve(abs).toLowerCase();
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.scheme === "file" && path.resolve(d.uri.fsPath).toLowerCase() === want);
  return doc;
}

async function tryEditDoc(abs) {
  // Simulates the user typing into the file while a check is open.
  const doc = openDocText(abs) || (await vscode.workspace.openTextDocument(vscode.Uri.file(abs)));
  const before = doc.getText();
  const edit = new vscode.WorkspaceEdit();
  edit.insert(doc.uri, new vscode.Position(0, 0), "// USER TYPED\n");
  await vscode.workspace.applyEdit(edit);
  await sleep(700);
  const after = doc.getText();
  const locked = after === before;
  if (!locked) {
    // undo our probe so later checks see agent text only
    const fix = new vscode.WorkspaceEdit();
    fix.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(after.length)), before);
    await vscode.workspace.applyEdit(fix);
    await doc.save();
  }
  return locked;
}

// ---------- scenarios ----------
const scenarios = {};

scenarios["edit-replay-pass"] = async () => {
  const { f, project } = fixture("edit-twice", "s-edit-pass");
  const ev = f.hookEvents.filter((e) => e.payload.tool_name === "Edit");
  const app = path.join(project, "app.js");
  const intermediate = ev[3].payload.tool_response.originalFile;
  let during;
  let locked;
  quizPolicy = async (msg) => {
    await sleep(400);
    during = read(app);
    locked = await tryEditDoc(app);
    return correct(msg);
  };
  await hook(ev[0].payload);
  fs.writeFileSync(app, intermediate);
  await hook(ev[1].payload);
  await hook(ev[2].payload);
  fs.writeFileSync(app, f.finalFiles["app.js"]);
  await hook(ev[3].payload);
  await waitFor(() => panels.length > 0 && panels.every((p) => p.disposed), 20000);
  await idle();
  const after = read(app);
  const quizzes = panels.length;
  record("A2", "Edit replay (small + large edit to one file), pass", "1 quiz (small edit skipped); code withheld from disk while quiz open; file locked; code written back on pass",
    { quizzes, withheldDuringQuiz: during === intermediate, lockedDuringQuiz: locked, finalHasCode: after === f.finalFiles["app.js"] },
    quizzes === 1 && during === intermediate && locked && after === f.finalFiles["app.js"] ? "PASS" : "BUG");
};

scenarios["edit-replay-fail"] = async () => {
  const { f, project } = fixture("edit-twice", "s-edit-fail");
  const ev = f.hookEvents.filter((e) => e.payload.tool_name === "Edit");
  const app = path.join(project, "app.js");
  const intermediate = ev[3].payload.tool_response.originalFile;
  const start = panels.length;
  quizPolicy = async () => {
    await sleep(300);
    return { type: "close" };
  };
  await hook(ev[2].payload);
  fs.writeFileSync(app, f.finalFiles["app.js"]);
  await hook(ev[3].payload);
  await waitFor(() => panels.length > start && panels.every((p) => p.disposed), 20000);
  await idle();
  const after = read(app);
  record("A3", "Edit replay, close the quiz (fail)", "agent hunk removed; file equals text before the edit",
    { quizzes: panels.length - start, reverted: after === intermediate },
    panels.length - start === 1 && after === intermediate ? "PASS" : "BUG");
};

scenarios["write-new-fail"] = async () => {
  const { f, project } = fixture("write-new-overwrite", "s-write");
  const ev = f.hookEvents.filter((e) => e.payload.tool_name === "Write");
  const strings = path.join(project, "utils", "strings.js");
  const start = panels.length;
  let during;
  quizPolicy = async () => {
    await sleep(300);
    during = fs.existsSync(strings);
    return { type: "close" };
  };
  await hook(ev[0].payload);
  fs.mkdirSync(path.dirname(strings), { recursive: true });
  fs.writeFileSync(strings, f.finalFiles["utils\\strings.js"] ?? f.finalFiles["utils/strings.js"]);
  await hook(ev[1].payload);
  await waitFor(() => panels.length > start && panels.every((p) => p.disposed), 20000);
  await idle();
  const existsAfter = fs.existsSync(strings);
  record("A4", "Write of a NEW file, close the quiz", "file hidden during quiz and gone after a fail",
    { quizzes: panels.length - start, existedDuringQuiz: during, existsAfter },
    panels.length - start === 1 && !during && !existsAfter ? "PASS" : "BUG");
};

scenarios["write-overwrite-pass"] = async () => {
  const { f, project } = fixture("write-new-overwrite", "s-over");
  const ev = f.hookEvents.filter((e) => e.payload.tool_name === "Write");
  const cfg = path.join(project, "config.js");
  const start = panels.length;
  let during;
  quizPolicy = async (msg) => {
    await sleep(300);
    during = read(cfg);
    return correct(msg);
  };
  await hook(ev[2].payload);
  fs.writeFileSync(cfg, f.finalFiles["config.js"]);
  await hook(ev[3].payload);
  await waitFor(() => panels.length > start && panels.every((p) => p.disposed), 20000);
  await idle();
  record("A5", "Write overwriting an existing file, pass", "old content on disk during quiz; new content after pass",
    { quizzes: panels.length - start, oldDuringQuiz: during === f.seed["config.js"], newAfter: read(cfg) === f.finalFiles["config.js"] },
    panels.length - start === 1 && during === f.seed["config.js"] && read(cfg) === f.finalFiles["config.js"] ? "PASS" : "BUG");
};

scenarios["notebook-fail"] = async () => {
  const { f, project } = fixture("notebook", "s-nb");
  const ev = f.hookEvents.filter((e) => e.payload.tool_name === "NotebookEdit");
  const nb = path.join(project, "analysis.ipynb");
  const start = panels.length;
  const warnStart = warnings.length;
  let during;
  quizPolicy = async () => {
    await sleep(300);
    during = read(nb);
    return { type: "close" };
  };
  await hook(ev[0].payload);
  fs.writeFileSync(nb, f.finalFiles["analysis.ipynb"]);
  await hook(ev[1].payload);
  await waitFor(() => panels.length > start && panels.every((p) => p.disposed), 20000);
  await idle();
  const after = read(nb);
  const kept = after === f.finalFiles["analysis.ipynb"];
  record("A6", "NotebookEdit replay, close the quiz (fail)", "notebook restored to the pre-edit version",
    {
      quizzes: panels.length - start,
      codeOnDiskDuringQuiz: during === f.finalFiles["analysis.ipynb"],
      codeKeptAfterFail: kept,
      warning: warnings.slice(warnStart).map((w) => w.message),
    },
    panels.length - start === 1 && !kept ? "PASS" : "BUG", { bug: "BUG-A1" });
};

scenarios["auto-2files"] = async () => {
  await setMode("auto");
  await resetEditors();
  const start = panels.length;
  const infoStart = infos.length;
  quizPolicy = async (msg) => {
    await sleep(200);
    return correct(msg);
  };
  await claudeWriteBatch([
    [path.join(WS, "s-auto2", "a.js"), code("alpha", 40)],
    [path.join(WS, "s-auto2", "b.js"), code("beta", 40)],
  ]);
  await waitFor(() => panels.length - start >= 2 && panels.every((p) => p.disposed), 30000);
  await idle();
  const toasts = infos.slice(infoStart).filter((i) => /files changed/.test(i.message));
  record("B1", "auto mode, 2 files / 80 lines in one batch", "no walkthrough; one quiz per file",
    { quizzes: panels.length - start, walkthroughToasts: toasts.length },
    panels.length - start === 2 && toasts.length === 0 ? "PASS" : "BUG");
};

scenarios["auto-7files-pending-toast"] = async () => {
  await setMode("auto");
  await resetEditors();
  const start = panels.length;
  const infoStart = infos.length;
  let resolveToast;
  infoHandler = (m) => (/files changed/.test(m) ? new Promise((r) => (resolveToast = r)) : undefined);
  quizPolicy = async (msg) => {
    await sleep(200);
    return correct(msg);
  };
  const dir = path.join(WS, "s-auto7");
  const items = ["m1", "m2", "m3", "m4", "m5", "m6", "m7"].map((n) => [path.join(dir, n + ".js"), code(n, 30)]);
  await claudeWriteBatch(items);
  const toast = await waitFor(() => infos.slice(infoStart).find((i) => /files changed/.test(i.message)), 15000);
  await sleep(1500);
  const onDisk = items.filter(([abs, text]) => read(abs) === text).length;
  const locked = await tryEditDoc(items[0][0]);
  // Another single large agent edit while the toast is still unanswered.
  const extra = path.join(WS, "s-auto7-extra", "late.js");
  await claudeWrite(extra, code("late", 30));
  await sleep(6000);
  const quizzesWhilePending = panels.length - start;
  const lateOnDisk = read(extra) !== undefined;
  resolveToast && resolveToast("Snooze");
  infoHandler = () => undefined;
  await waitFor(() => panels.length - start >= 1, 15000);
  await idle();
  record("B2", "auto mode, 7 files in one batch", "walkthrough offered (>= 7 files)",
    { toast: toast && toast.message, items: toast && toast.items }, toast ? "PASS" : "BUG");
  record("B3", "held code and locks while a walkthrough is offered", "README: agent code stays out of the file until a check is passed",
    { filesWithAgentCodeOnDisk: onDisk + "/7", fileLockedWhileOffered: locked, quizPanels: 0 },
    onDisk === 7 && !locked ? "BUG" : "PASS", { bug: "BUG-B1" });
  record("B4", "a new agent edit while the walkthrough toast is unanswered", "the new edit is checked promptly",
    { quizzesWhileToastPending: quizzesWhilePending, lateFileOnDisk: lateOnDisk, quizzesAfterToastAnswered: panels.length - start },
    quizzesWhilePending === 0 ? "BUG" : "PASS", { bug: "BUG-B2" });
};

scenarios["auto-1file-600lines"] = async () => {
  await setMode("auto");
  await resetEditors();
  const start = panels.length;
  const infoStart = infos.length;
  infoHandler = (m, items) => (items.includes("Start session 1") ? "Start session 1" : undefined);
  let during;
  const big = path.join(WS, "s-big", "huge.js");
  quizPolicy = async (msg) => {
    during = read(big) !== undefined;
    await sleep(100);
    return correct(msg);
  };
  await claudeWrite(big, code("huge", 600));
  await waitFor(() => panels.length > start && panels.every((p) => p.disposed), 20000);
  await idle();
  const toastLong = infos.slice(infoStart).find((i) => /files changed/.test(i.message));
  record("B5a", "auto mode, ONE file, 600 lines of ~50 chars (30 kB)", "a held comprehension check (README)",
    { toast: toastLong && toastLong.message, panels: panels.length - start, questions: panels.slice(start).map((p) => p.questions), codeOnDiskDuringQuiz: during },
    toastLong ? "BUG" : "PASS (held quiz; lines counted after the 24k-char cut, so this 600-line file counts as ~480)");

  // Same line count, short lines: stays under the 24k cut, so all 600 lines count.
  const start2 = panels.length;
  const info2 = infos.length;
  const small = path.join(WS, "s-big", "table.js");
  let during2;
  quizPolicy = async (msg) => {
    during2 = read(small) !== undefined;
    await sleep(100);
    return correct(msg);
  };
  const rows = ["// lookup table generated by the agent", "const T = ["];
  for (let i = 0; rows.length < 599; i++) {
    rows.push(`  [${i}, ${i * 3}],`);
  }
  rows.push("];");
  const tableText = rows.join("\n") + "\nfunction lookup(i) { if (i < 0) { return 0; } return T[i][1]; }\n";
  await claudeWrite(small, tableText);
  await waitFor(() => panels.length > start2 && panels.every((p) => p.disposed), 20000);
  await idle();
  infoHandler = () => undefined;
  const toast = infos.slice(info2).find((i) => /files changed/.test(i.message));
  record("B5", "auto mode, ONE file, 600 short lines (line threshold)", "README: a large agent write gets a held comprehension check",
    { toast: toast && toast.message, panels: panels.length - start2, questions: panels.slice(start2).map((p) => p.questions), codeOnDiskDuringSession: during2, codeOnDiskAfter: read(small) === tableText },
    toast ? "BUG" : "PASS", { bug: "BUG-B3" });
  record("B6", "walkthrough Start -> session 1 with MC/free-text/ordering, all correct", "session runs 3 question kinds and passes",
    { questions: panels.slice(start2).map((p) => p.questions) },
    toast && panels.length - start2 === 1 && JSON.stringify(panels[start2].questions) === JSON.stringify(["multiple-choice", "free-text", "ordering"]) ? "PASS" : "BUG");
};

scenarios["walkthrough-mode-dismiss"] = async () => {
  await setMode("walkthrough");
  await resetEditors();
  const start = panels.length;
  const infoStart = infos.length;
  infoHandler = () => undefined; // user closes the toast
  const dir = path.join(WS, "s-wdismiss");
  await claudeWriteBatch([[path.join(dir, "p.js"), code("pee", 20)], [path.join(dir, "q.js"), code("queue", 20)]]);
  await waitFor(() => infos.slice(infoStart).some((i) => /files changed/.test(i.message)), 15000);
  await idle();
  const toast = infos.slice(infoStart).find((i) => /files changed/.test(i.message));
  record("B7", "mode=walkthrough, 2 files, toast dismissed", "walkthrough offered for 2 files; dismiss = snooze 24h, no quiz",
    { toast: toast && toast.message, quizzes: panels.length - start, codeKept: read(path.join(dir, "p.js")) !== undefined },
    toast && panels.length === start ? "PASS" : "BUG");
};

scenarios["walkthrough-mode-later"] = async () => {
  await setMode("walkthrough");
  await resetEditors();
  const start = panels.length;
  const infoStart = infos.length;
  infoHandler = (m, items) => (items.includes("Later today") ? "Later today" : undefined);
  const dir = path.join(WS, "s-wlater");
  await claudeWriteBatch([[path.join(dir, "r.js"), code("arr", 20)], [path.join(dir, "s.js"), code("ess", 20)]]);
  await waitFor(() => infos.slice(infoStart).some((i) => /files changed/.test(i.message)), 15000);
  await idle();
  infoHandler = () => undefined;
  const toast = infos.slice(infoStart).find((i) => /files changed/.test(i.message));
  record("B8", "mode=walkthrough, 2 files, Later today", "saved with 8h snooze; no quiz now",
    { toast: toast && toast.message, quizzes: panels.length - start }, toast && panels.length === start ? "PASS" : "BUG");
};

scenarios["learn-8files"] = async () => {
  await setMode("learn");
  await resetEditors();
  const start = panels.length;
  const infoStart = infos.length;
  quizPolicy = async (msg) => {
    await sleep(50);
    return correct(msg);
  };
  const dir = path.join(WS, "s-learn");
  await claudeWriteBatch(["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"].map((n) => [path.join(dir, n + ".js"), code(n, 30)]));
  await waitFor(() => panels.length - start >= 8 && panels.every((p) => p.disposed), 90000);
  await idle();
  const toast = infos.slice(infoStart).find((i) => /files changed/.test(i.message));
  record("B9", "mode=learn, 8 files in one batch", "no walkthrough; one quiz per file",
    { quizzes: panels.length - start, toast: !!toast }, panels.length - start === 8 && !toast ? "PASS" : "BUG");
};

scenarios["claude-timing-8writes"] = async () => {
  // Replays the real parallel-writes timing: 8 Writes ~1.5s apart.
  await setMode("auto");
  await resetEditors();
  const start = panels.length;
  const infoStart = infos.length;
  let resolveToast;
  infoHandler = (m) => (/files changed/.test(m) ? new Promise((r) => (resolveToast = r)) : undefined);
  const dir = path.join(WS, "s-timing");
  const files = ["mod1", "mod2", "mod3", "mod4", "mod5", "mod6", "mod7", "mod8"].map((n) => [path.join(dir, n + ".js"), code(n, 28)]);
  let firstQuizSaw;
  quizPolicy = async (msg, rec, index) => {
    if (panels.indexOf(rec) === start && index === 0) {
      await sleep(13000); // the student takes a while on the first check
      firstQuizSaw = files.map(([abs]) => (read(abs) !== undefined ? 1 : 0)).join("");
    }
    return correct(msg);
  };
  for (const [abs, text] of files) {
    await claudeWrite(abs, text);
    await sleep(1300);
  }
  const toast = await waitFor(() => infos.slice(infoStart).find((i) => /files changed/.test(i.message)), 30000);
  const onDisk = files.filter(([abs, text]) => read(abs) === text).length;
  resolveToast && resolveToast("Snooze");
  infoHandler = () => undefined;
  await idle();
  record("B10", "real Claude timing: 8 Writes ~1.5s apart (from the parallel-writes capture), first quiz left open 13s", "either one walkthrough for all 8, or a held check for every file",
    { quizzes: panels.length - start, filesPresentWhileFirstQuizOpen: firstQuizSaw, walkthroughToast: toast && toast.message, filesWithCodeAfterSnooze: onDisk + "/8" },
    toast ? "BUG" : "PASS", { bug: "BUG-B4" });
};

scenarios["queue-overflow"] = async () => {
  await setMode("learn");
  await resetEditors();
  const start = panels.length;
  const statusStart = statuses.length;
  let release;
  const gate = new Promise((r) => (release = r));
  quizPolicy = async (msg, rec) => {
    if (panels.indexOf(rec) === start) {
      await gate;
    }
    await sleep(30);
    return correct(msg);
  };
  const dir = path.join(WS, "s-overflow");
  await claudeWrite(path.join(dir, "first.js"), code("first", 20));
  await waitFor(() => panels.length > start, 15000);
  const later = [];
  for (let i = 0; i < 14; i++) {
    later.push([path.join(dir, "f" + i + ".js"), code("f" + i, 20)]);
  }
  await claudeWriteBatch(later);
  await sleep(2000);
  release();
  await waitFor(() => panels.every((p) => p.disposed) && panels.length - start >= 13, 120000);
  await idle(4000);
  const skipped = statuses.slice(statusStart).filter((s) => /skipping extra agent edits/.test(s.message)).length;
  const quizzes = panels.length - start;
  const kept = later.filter(([abs]) => read(abs) !== undefined).length;
  record("B11", "15 agent edits while one check is open (mode=learn)", "every edit is checked",
    { quizzes, skippedStatusMessages: skipped, filesOnDisk: kept + "/14" },
    quizzes === 15 ? "PASS" : "BUG", { bug: "BUG-B5" });
};

scenarios["disk-fallback"] = async () => {
  await setMode("learn");
  await resetEditors();
  const dir = path.join(WS, "s-disk");
  fs.mkdirSync(dir, { recursive: true });
  const openFile = path.join(dir, "open.js");
  const closedFile = path.join(dir, "closed.js");
  fs.writeFileSync(openFile, "module.exports = {};\n");
  fs.writeFileSync(closedFile, "module.exports = {};\n");
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(openFile));
  await vscode.window.showTextDocument(doc, { preview: false });
  // Make another file active so the change does not come from the focused editor.
  const other = path.join(dir, "other.txt");
  fs.writeFileSync(other, "x\n");
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(other)), { preview: false });
  await sleep(1500);
  const start = panels.length;
  quizPolicy = async () => {
    await sleep(300);
    return { type: "close" };
  };
  // What `cat >> open.js <<EOF` from Claude's Bash tool does.
  fs.appendFileSync(openFile, "\n" + code("sumSquares", 12));
  fs.appendFileSync(closedFile, "\n" + code("sumSquares", 12));
  await waitFor(() => panels.length > start && panels.every((p) => p.disposed), 20000);
  await idle();
  const openAfter = read(openFile);
  const closedAfter = read(closedFile);
  record("A7", "Bash-style write (no hook) to a file OPEN in the editor", "disk fallback quizzes it; closing reverts",
    { quizzes: panels.length - start, reverted: openAfter === "module.exports = {};\n" },
    panels.length - start >= 1 && openAfter === "module.exports = {};\n" ? "PASS" : "BUG");
  record("A8", "Bash-style write (no hook) to a file NOT open", "missed (documented limitation)",
    { codeKept: /sumSquares/.test(closedAfter) }, /sumSquares/.test(closedAfter) ? "PASS (limitation)" : "BUG");

  // Burst of 4 open files changing at once (git checkout) stays quiet.
  const burst = ["b1", "b2", "b3", "b4"].map((n) => path.join(dir, n + ".js"));
  for (const b of burst) {
    fs.writeFileSync(b, "module.exports = {};\n");
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(b)), { preview: false });
  }
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(other)), { preview: false });
  await sleep(1500);
  const start2 = panels.length;
  for (const b of burst) {
    fs.appendFileSync(b, "\n" + code("burst", 12));
  }
  await sleep(5000);
  record("A9", "4 open files changed from disk at once", "treated as checkout, no quiz",
    { quizzes: panels.length - start2 }, panels.length === start2 ? "PASS" : "BUG");
};

scenarios["inbox"] = async () => {
  await setMode("learn");
  await resetEditors();
  const { f, project } = fixture("edit-twice", "s-inbox");
  const app = path.join(project, "app.js");
  fs.writeFileSync(app, f.finalFiles["app.js"]);
  const ev = f.hookEvents.filter((e) => e.payload.tool_name === "Edit");
  // Produce the inbox file exactly as notify.js does when the editor is closed.
  const offline = fs.mkdtempSync(path.join(os.tmpdir(), "cg-offline-"));
  await hook(ev[2].payload, offline);
  await hook(ev[3].payload, offline);
  const inboxOut = path.join(offline, ".comprehension-guard", "inbox");
  const name = fs.readdirSync(inboxOut)[0];
  const env = JSON.parse(fs.readFileSync(path.join(inboxOut, name), "utf8"));
  const realInbox = path.join(HOME, ".comprehension-guard", "inbox");
  fs.mkdirSync(realInbox, { recursive: true });
  const intermediate = ev[3].payload.tool_response.originalFile;

  const start = panels.length;
  quizPolicy = async () => {
    await sleep(200);
    return { type: "close" };
  };
  // Stale: 181 s old.
  const stale = { ...env, receivedAt: Date.now() - 181_000 };
  fs.writeFileSync(path.join(realInbox, "0000-stale.json"), JSON.stringify(stale));
  await sleep(4000);
  const afterStale = panels.length - start;
  const staleFileGone = !fs.existsSync(path.join(realInbox, "0000-stale.json"));
  // Fresh: 170 s old.
  const fresh = { ...env, receivedAt: Date.now() - 170_000 };
  fs.writeFileSync(path.join(realInbox, "0001-fresh.json"), JSON.stringify(fresh));
  await waitFor(() => panels.length > start && panels.every((p) => p.disposed), 15000);
  await idle();
  record("A10", "inbox: event 181 s old", "dropped (older than 3 min)", { quizzes: afterStale, inboxFileDeleted: staleFileGone },
    afterStale === 0 && staleFileGone ? "PASS" : "BUG");
  record("A11", "inbox: event 170 s old, close the quiz", "quizzed and reverted",
    { quizzes: panels.length - start - afterStale, reverted: read(app) === intermediate },
    panels.length - start - afterStale === 1 && read(app) === intermediate ? "PASS" : "BUG");
  fs.rmSync(offline, { recursive: true, force: true });
};

const PHASES = {
  main: [
    "edit-replay-pass",
    "edit-replay-fail",
    "write-new-fail",
    "write-overwrite-pass",
    "notebook-fail",
    "inbox",
    "disk-fallback",
    "auto-2files",
    "auto-7files-pending-toast",
    "auto-1file-600lines",
    "learn-8files",
    "queue-overflow",
    "claude-timing-8writes",
    "walkthrough-mode-dismiss",
    "walkthrough-mode-later", // leaves an 8h snooze for the resume phases
  ],
  "resume-snoozed": [],
  "resume-expired": [],
  live: [],
};

async function resumePhase() {
  // The extension calls resumeWalkthrough() on activation; we only watch.
  infoHandler = (m) => (/is ready/.test(m) ? (PHASE === "resume-expired" ? "Start" : undefined) : undefined);
  quizPolicy = async (msg) => {
    await sleep(50);
    return wrong(msg); // every answer wrong
  };
  await sleep(8000);
  await idle();
  const ready = infos.find((i) => /is ready/.test(i.message));
  // VS Code 1.145 under @vscode/test-electron did not persist globalState between
  // launches in our runs (no state.vscdb was written), so these phases can only
  // show a toast if persistence works on the machine running them.
  if (PHASE === "resume-snoozed") {
    record("C1", "next activation while the 8h 'Later today' snooze is active", "no resume toast",
      { resumeToast: ready && ready.message, extActiveBeforeStubs: extActiveAtLoad }, !ready ? "PASS" : "BUG");
  } else {
    record("C2", "next activation after the snooze expired (clock +9h)", "toast 'walkthrough session 1 is ready'; Start runs it",
      { resumeToast: ready && ready.message, panels: panels.length, questions: panels.map((p) => p.questions), extActiveBeforeStubs: extActiveAtLoad },
      ready && panels.length === 1 ? "PASS" : "BUG");
  }
}

exports.run = async function run() {
  note("suite-start", { extActiveAtLoad });
  const ext = vscode.extensions.getExtension(EXT_ID);
  if (!ext) {
    throw new Error("extension not found");
  }
  await ext.activate();
  const endpoint = path.join(HOME, ".comprehension-guard", "endpoint.json");
  await waitFor(() => {
    try {
      return JSON.parse(fs.readFileSync(endpoint, "utf8")).pid === process.pid;
    } catch {
      return false;
    }
  }, 15000);
  note("endpoint-ready");
  try {
    if (PHASE.startsWith("resume")) {
      await resumePhase();
    } else if (PHASE === "live") {
      await require("./live.js")({
        WS, HOME, NODE, REPO, panels, warnings, setMode, idle, record, read, sleep, correct,
        setQuizPolicy: (fn) => {
          quizPolicy = fn;
        },
      });
    } else {
      const only = (process.env.CG_E2E_ONLY || "").split(",").filter(Boolean);
      for (const name of PHASES[PHASE]) {
        if (only.length && !only.includes(name)) {
          continue;
        }
        note("scenario", { name });
        try {
          await scenarios[name]();
        } catch (err) {
          record(name, name, "", { error: String(err && err.stack || err) }, "HARNESS-ERROR");
        }
        infoHandler = () => undefined;
        quizPolicy = () => ({ type: "close" });
        await resetEditors();
      }
    }
  } finally {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(
      path.join(OUT, PHASE + ".json"),
      JSON.stringify({ phase: PHASE, extActiveAtLoad, vscodeVersion: vscode.version, results, infos, warnings, panels, timeline, llmCalls: llm.calls.length }, null, 2),
    );
  }
};
