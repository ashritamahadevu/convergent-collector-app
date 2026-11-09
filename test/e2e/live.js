"use strict";

/**
 * "live" phase: the REAL Claude Code CLI edits a file twice while the REAL
 * extension (in this VS Code window) holds the first edit behind a quiz.
 * Hooks are the ones planHookInstall writes, in a project-level
 * .claude/settings.json, pointing at COMPREHENSION_GUARD_HOME. One run.
 */

const cp = require("child_process");
const fs = require("fs");
const path = require("path");

module.exports = async function livePhase(h) {
  const { WS, HOME, NODE, REPO, panels, warnings, setMode, setQuizPolicy, idle, record, read, sleep, correct } = h;
  await setMode("learn");
  const proj = path.join(WS, "live project");
  fs.mkdirSync(path.join(proj, ".claude"), { recursive: true });
  const seed = "function greet() {\n  return 'hi';\n}\n// TODO: add helpers\nmodule.exports = { greet };\n";
  const app = path.join(proj, "app.js");
  fs.writeFileSync(app, seed);
  const guardDir = path.join(HOME, ".comprehension-guard");
  fs.copyFileSync(path.join(REPO, "hook", "notify.js"), path.join(guardDir, "notify.js"));
  const command = `"${NODE}" "${path.join(guardDir, "notify.js")}"`;
  const matcher = "Edit|Write|NotebookEdit|MultiEdit";
  fs.writeFileSync(
    path.join(proj, ".claude", "settings.json"),
    JSON.stringify(
      {
        hooks: {
          PreToolUse: [{ matcher, hooks: [{ type: "command", command, timeout: 10 }] }],
          PostToolUse: [{ matcher, hooks: [{ type: "command", command, timeout: 10, async: true }] }],
        },
        env: { COMPREHENSION_GUARD_HOME: HOME },
      },
      null,
      2,
    ),
  );

  const start = panels.length;
  const warnStart = warnings.length;
  const diskSeenByFirstQuiz = [];
  setQuizPolicy(async (msg, rec, index) => {
    if (panels.indexOf(rec) === start && index === 0) {
      for (let i = 0; i < 25; i++) {
        diskSeenByFirstQuiz.push(read(app));
        await sleep(1000);
      }
    }
    await sleep(200);
    return correct(msg);
  });

  const exe = path.join(process.env.APPDATA || "", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
  const prompt =
    "You are in a test project. Do not use Bash. Step 1: Read app.js. Step 2: use the Edit tool to replace '// TODO: add helpers' " +
    "with 10 to 14 lines of JavaScript defining clamp(x, min, max), sum(arr) and average(arr), each with a comment. " +
    "Step 3: use the Edit tool a SECOND time to add, directly after the average function, a 10 line function median(arr) with comments. Then stop.";
  const started = Date.now();
  const stream = [];
  const code = await new Promise((resolve) => {
    const child = cp.spawn(
      exe,
      ["-p", prompt, "--model", "haiku", "--max-turns", "8", "--permission-mode", "acceptEdits", "--setting-sources", "project", "--output-format", "stream-json", "--verbose"],
      { cwd: proj, env: { ...process.env, COMPREHENSION_GUARD_HOME: HOME }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        try {
          stream.push({ t: Date.now() - started, ...JSON.parse(line) });
        } catch {
          // partial
        }
      }
    });
    const timer = setTimeout(() => child.kill(), 240000);
    child.on("exit", (c) => {
      clearTimeout(timer);
      resolve(c);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve(String(e));
    });
  });
  const claudeMs = Date.now() - started;
  await sleep(3000);
  await idle(4000);
  const toolUses = [];
  const toolErrors = [];
  for (const m of stream) {
    if (m.type === "assistant") {
      for (const c of m.message.content || []) {
        if (c.type === "tool_use") {
          toolUses.push({ t: m.t, name: c.name, old: (c.input.old_string || "").slice(0, 40) });
        }
      }
    }
    if (m.type === "user") {
      for (const c of (m.message && m.message.content) || []) {
        if (c.type === "tool_result" && c.is_error) {
          toolErrors.push({ t: m.t, text: String(typeof c.content === "string" ? c.content : JSON.stringify(c.content)).slice(0, 200) });
        }
      }
    }
  }
  const final = read(app);
  const distinct = [...new Set(diskSeenByFirstQuiz.map((t) => (t === seed ? "seed" : /median/.test(t) ? "with-median" : /clamp/.test(t) ? "with-clamp" : "other")))];
  record(
    "L1",
    "LIVE: real Claude Code 2.1.316 edits app.js twice while the first edit is held behind an open quiz (25s), then pass",
    "both edits end up in the file after passing; Claude is not confused by the withheld code",
    {
      claudeExit: code,
      claudeMs,
      quizzes: panels.length - start,
      diskStatesSeenDuringFirstQuiz: distinct,
      claudeToolUses: toolUses,
      claudeToolErrors: toolErrors,
      finalHasClamp: /clamp/.test(final || ""),
      finalHasMedian: /median/.test(final || ""),
      clampDefinitions: ((final || "").match(/function clamp/g) || []).length,
      warnings: warnings.slice(warnStart).map((w) => w.message),
      finalFile: final,
    },
    /clamp/.test(final || "") && /median/.test(final || "") && ((final || "").match(/function clamp/g) || []).length === 1 ? "PASS" : "BUG",
    { bug: "BUG-L1" },
  );
};
