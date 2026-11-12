/**
 * The pause gate, driven through the real hook process and the same
 * PauseSession the extension uses.
 *
 * What this locks in:
 * - Claude Code, Codex, the Cursor agent, and Gemini CLI are wired to pause.
 * - A pause holds the tool until the student answers. It does not rewrite
 *   the tool call the model already chose.
 * - An allow can add one sentence telling the model to write the next chunk.
 *   A deny adds one short reason and leaves the planned edit unexecuted.
 * - The quiz text stays out of the hook output, so it never enters the model.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { planHookInstall } from "../../src/agentProtocol";
import type { LearnerPreferences } from "../../src/sizing/chunkPolicy";
import { PauseSession, type PauseWire } from "../../src/sizing/pauseSession";
import type { CheckPreset, LocalQuestion } from "../../src/sizing/types";

function prefs(preset: CheckPreset, extra: Partial<LearnerPreferences> = {}): LearnerPreferences {
  return { preset, ...extra };
}

const PAUSE = path.join(__dirname, "..", "..", "hook", "pause.js");
const MODEL_DENY =
  "Comprehension Guard paused this write. The student is answering a check on the previous code. Wait, then retry the same edit.";

const COALESCE = `function coalesce(bp) {
  if (!prev) return bp;
  if (!next) return prev;
  return bp;
}`;

const OTHER = `function release(block) {
  if (!block) return;
  if (block.free) return;
  free(block);
}`;

type Gate = {
  session: PauseSession;
  prompts: string[][];
  bodies: unknown[];
  answer(ok: boolean): void;
  close(): Promise<void>;
  port: number;
  home: string;
};

function runPause(
  payload: unknown,
  home: string,
): Promise<{ code: number; stdout: string; stderr: string; ms: number }> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [PAUSE], {
      env: { ...process.env, COMPREHENSION_GUARD_HOME: home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("exit", (code) =>
      resolve({ code: code ?? -1, stdout, stderr, ms: Date.now() - started }),
    );
    child.stdin.end(typeof payload === "string" ? payload : JSON.stringify(payload));
  });
}

async function startGate(preset: CheckPreset = "standard"): Promise<Gate> {
  const home = fs.mkdtempSync(path.join(tmpdir(), "pause-rigorous-"));
  const prompts: string[][] = [];
  const waiters: Array<(ok: boolean) => void> = [];
  const session = new PauseSession((questions: LocalQuestion[]) => {
    prompts.push(questions.map((question) => question.prompt));
    return new Promise((resolve) => waiters.push(resolve));
  });
  const bodies: unknown[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown = raw;
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
      bodies.push(body);
      void session
        .onPause(body, { enabled: true, preferences: prefs(preset) })
        .then((decision) => send(res, decision))
        .catch(() => send(res, { allow: true, reason: "continue", userMessage: "", agentMessage: "" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as { port: number }).port;
  const dir = path.join(home, ".comprehension-guard");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "endpoint.json"), JSON.stringify({ port, token: "tok" }));
  return {
    session,
    prompts,
    bodies,
    answer(ok: boolean) {
      const next = waiters.shift();
      if (!next) {
        throw new Error("no open check");
      }
      next(ok);
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(home, { recursive: true, force: true });
    },
    port,
    home,
  };
}

function send(res: ServerResponse, decision: PauseWire): void {
  const raw = JSON.stringify(decision);
  res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(raw) });
  res.end(raw);
}

function claudeWrite(content: string, sessionId: string, tool = "Write") {
  return {
    hook_event_name: "PreToolUse",
    session_id: sessionId,
    tool_name: tool,
    tool_input: { file_path: "/tmp/mm.js", content },
  };
}

function forwardedContent(body: unknown): string {
  const record = body as { payload?: { tool_input?: { content?: string } } };
  return record.payload?.tool_input?.content ?? "";
}

test("installed hooks pause every agent with a pre-tool gate, and not their shell tools", () => {
  const plan = planHookInstall({
    homeDir: "/tmp/guard-coverage",
    nodePath: "/usr/bin/node",
    scriptSource: "// notify",
    pauseSource: "// pause",
    claude: { kind: "missing" },
    codex: { kind: "missing" },
    cursor: { kind: "missing" },
  });
  const paths = plan.writes.map((write) => write.path.replace(/\\/g, "/"));
  assert.ok(paths.some((file) => file.endsWith("/.claude/settings.json")));
  assert.ok(paths.some((file) => file.endsWith("/.codex/hooks.json")));
  assert.ok(paths.some((file) => file.endsWith("/.cursor/hooks.json")));
  assert.ok(paths.some((file) => file.endsWith("/.gemini/settings.json")));
  assert.ok(paths.some((file) => file.endsWith("/.copilot/hooks/comprehension-guard.json")));
  assert.ok(paths.some((file) => file.endsWith("/.factory/hooks.json")));
  assert.ok(paths.some((file) => file.endsWith("/comprehension-guard/hooks/hooks.json")));
  assert.ok(paths.some((file) => file.endsWith("/.gemini/config/hooks.json")));
  assert.equal(paths.some((file) => /aider|continue|clinerules/i.test(file)), false);

  const claude = JSON.parse(plan.writes.find((write) => write.path.includes(`${path.sep}.claude${path.sep}`))!.contents);
  const codex = JSON.parse(plan.writes.find((write) => write.path.includes(`${path.sep}.codex${path.sep}`))!.contents);
  const claudeTools = claude.hooks.PreToolUse[0].matcher.split("|");
  const codexTools = codex.hooks.PreToolUse[0].matcher.split("|");
  for (const tool of ["Edit", "Write", "NotebookEdit", "MultiEdit"]) {
    assert.ok(claudeTools.includes(tool), tool);
  }
  assert.equal(claudeTools.includes("Bash"), false);
  assert.equal(claudeTools.includes("PowerShell"), false);
  assert.ok(codexTools.includes("apply_patch"));
  assert.equal(codexTools.includes("Bash"), false);

  const gemini = JSON.parse(plan.writes.find((write) => write.path.includes(`${path.sep}.gemini${path.sep}`))!.contents);
  const before = gemini.hooks.BeforeTool[0];
  assert.equal(before.matcher, "write_file|replace");
  assert.equal(before.sequential, true);
  assert.equal(before.hooks.length, 2);
  assert.match(before.hooks[0].command, /notify\.js/);
  assert.equal(before.hooks[0].timeout, 30_000);
  assert.match(before.hooks[1].command, /pause\.js/);
  assert.equal(before.hooks[1].timeout, 600_000);
  assert.equal(before.matcher.includes("run_shell_command"), false);
  assert.equal(gemini.hooks.AfterTool[0].hooks.length, 1);
  assert.match(gemini.hooks.AfterTool[0].hooks[0].command, /notify\.js/);

  const copilot = JSON.parse(
    plan.writes.find((write) => write.path.includes(`${path.sep}.copilot${path.sep}`))!.contents,
  );
  assert.equal(copilot.version, 1);
  assert.equal(copilot.hooks.PreToolUse.some((hook: { command: string }) => hook.command.includes("--agent=copilot")), true);
  assert.equal(copilot.hooks.PreToolUse.some((hook: { matcher: string }) => hook.matcher.includes("Bash")), false);
  const droid = JSON.parse(plan.writes.find((write) => write.path.includes(`${path.sep}.factory${path.sep}`))!.contents);
  assert.equal(droid.PreToolUse[0].matcher, "Create|Edit|ApplyPatch");
  assert.equal(droid.PreToolUse[0].matcher.includes("Execute"), false);
  const goose = JSON.parse(
    plan.writes.find((write) => write.path.includes(`${path.sep}comprehension-guard${path.sep}hooks${path.sep}`))!.contents,
  );
  assert.equal(goose.hooks.PreToolUse[0].matcher, "^(write|edit)$");
  const antigravity = JSON.parse(
    plan.writes.find((write) => write.path.includes(`${path.sep}.gemini${path.sep}config${path.sep}`))!.contents,
  );
  assert.equal(antigravity["comprehension-guard"].PreToolUse[0].matcher.includes("run_command"), false);
  assert.match(antigravity["comprehension-guard"].PreToolUse[0].hooks[1].command, /--agent=antigravity/);
});

test("a held Write keeps the planned edit and tells the model to write one chunk next", async () => {
  const gate = await startGate();
  try {
    const reasoning = "Add coalesce before touching the caller. Do not rename it.";
    const planned = { file_path: "/tmp/mm.js", content: COALESCE, reasoning };
    await gate.session.noteFile("s", prefs("standard"), "/tmp/mm.js", COALESCE, {
      snippet: COALESCE,
      hunks: [{ newText: COALESCE }],
    });
    assert.equal(gate.prompts.length, 1);
    const pending = runPause(
      { hook_event_name: "PreToolUse", session_id: "s", tool_name: "Write", tool_input: planned },
      gate.home,
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(gate.bodies.length, 1);
    assert.equal(forwardedContent(gate.bodies[0]), COALESCE);
    assert.equal((gate.bodies[0] as { payload: { tool_input: { reasoning: string } } }).payload.tool_input.reasoning, reasoning);
    gate.answer(true);
    const result = await pending;
    assert.ok(result.ms >= 200, "the hook returned before the student answered");
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const decision = JSON.parse(result.stdout);
    assert.equal(decision.hookSpecificOutput.permissionDecision, "allow");
    assert.equal(decision.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.match(decision.hookSpecificOutput.additionalContext, /You choose the next chunk/);
    assert.equal(decision.hookSpecificOutput.additionalContext.includes(COALESCE), false);
    assert.equal(result.stdout.includes(COALESCE), false);
    assert.equal(result.stdout.includes(gate.prompts[0][0]), false);
    assert.equal(result.stdout.includes(reasoning), false);
    assert.equal(gate.prompts.length, 1);

    const again = await runPause(claudeWrite("function next() { return 1; }", "s"), gate.home);
    assert.equal(JSON.parse(again.stdout).hookSpecificOutput.permissionDecision, "allow");
    assert.equal(gate.prompts.length, 1);
  } finally {
    await gate.close();
  }
});

test("a miss denies once, leaves the planned edit unchanged, and asks again on the next write", async () => {
  const gate = await startGate();
  try {
    await gate.session.noteFile("s", prefs("standard"), "/tmp/mm.js", COALESCE, {
      snippet: COALESCE,
      hunks: [{ newText: COALESCE }],
    });
    const first = runPause(claudeWrite(COALESCE, "s", "Edit"), gate.home);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(gate.prompts.length, 1);
    gate.answer(false);
    const denied = await first;
    assert.equal(denied.code, 0);
    assert.equal(denied.stderr, "");
    assert.deepEqual(JSON.parse(denied.stdout), {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: MODEL_DENY,
      },
    });
    assert.equal(denied.stdout.includes(COALESCE), false);
    assert.equal(denied.stdout.includes(gate.prompts[0][0]), false);
    assert.equal(forwardedContent(gate.bodies[0]), COALESCE);
    assert.equal(gate.prompts.length, 1);

    const second = runPause(claudeWrite(COALESCE, "s", "Edit"), gate.home);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(gate.prompts.length, 2);
    gate.answer(true);
    const allowed = await second;
    assert.equal(JSON.parse(allowed.stdout).hookSpecificOutput.permissionDecision, "allow");
  } finally {
    await gate.close();
  }
});

test("two writes share one open check, and a different session still has to pass its own", async () => {
  const gate = await startGate();
  try {
    await gate.session.noteFile("alpha", prefs("standard"), "/tmp/a.js", COALESCE, {
      snippet: COALESCE,
      hunks: [{ newText: COALESCE }],
    });
    await gate.session.noteFile("beta", prefs("standard"), "/tmp/b.js", OTHER, {
      snippet: OTHER,
      hunks: [{ newText: OTHER }],
    });
    assert.equal(gate.prompts.length, 1);

    const first = runPause(claudeWrite(COALESCE, "alpha"), gate.home);
    const second = runPause(
      {
        hook_event_name: "PreToolUse",
        session_id: "beta",
        tool_name: "Write",
        tool_input: { file_path: "/tmp/b.js", content: OTHER },
      },
      gate.home,
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(gate.bodies.length, 2);
    assert.equal(gate.prompts.length, 1);
    gate.answer(true);
    const alpha = await first;
    assert.equal(JSON.parse(alpha.stdout).hookSpecificOutput.permissionDecision, "allow");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(gate.prompts.length, 2, "beta was allowed on alpha's pass");
    gate.answer(true);
    const beta = await second;
    assert.equal(JSON.parse(beta.stdout).hookSpecificOutput.permissionDecision, "allow");
    assert.equal(gate.bodies.map(forwardedContent).join("\n").includes(OTHER), true);
    assert.equal(beta.stdout.includes(OTHER), false);
  } finally {
    await gate.close();
  }
});

test("Cursor shell can pause, Cursor Read cannot, and Codex apply_patch uses the Claude decision shape", async () => {
  const gate = await startGate();
  try {
    await gate.session.noteFile("s", prefs("standard"), "/tmp/mm.js", COALESCE, {
      snippet: COALESCE,
      hunks: [{ newText: COALESCE }],
    });
    const read = await runPause(
      { hook_event_name: "preToolUse", tool_name: "Read", tool_input: { file_path: "/tmp/mm.js" } },
      gate.home,
    );
    assert.deepEqual(JSON.parse(read.stdout), { permission: "allow" });
    assert.equal(gate.bodies.length, 0);

    const shell = runPause(
      {
        hook_event_name: "preToolUse",
        session_id: "s",
        tool_name: "Shell",
        tool_input: { command: "node test.js" },
      },
      gate.home,
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    gate.answer(false);
    const denied = await shell;
    assert.deepEqual(JSON.parse(denied.stdout), {
      permission: "deny",
      user_message: "Answer a short check on the code just written, then the agent continues.",
      agent_message: MODEL_DENY,
    });
    assert.equal(denied.stdout.includes("node test.js"), false);
  } finally {
    await gate.close();
  }

  const codex = await startGate();
  try {
    await codex.session.noteFile("s", prefs("standard"), "/tmp/mm.js", COALESCE, {
      snippet: COALESCE,
      hunks: [{ newText: COALESCE }],
    });
    const pending = runPause(
      { hook_event_name: "PreToolUse", session_id: "s", tool_name: "apply_patch", tool_input: { command: "*** Begin Patch" } },
      codex.home,
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    codex.answer(true);
    const result = await pending;
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "allow");
  } finally {
    await codex.close();
  }
});

test("agents with no pause hook, and a closed or broken editor, are not held", async () => {
  const home = fs.mkdtempSync(path.join(tmpdir(), "pause-open-"));
  try {
    for (const payload of [
      { tool_name: "Write", tool_input: { content: COALESCE } },
      { hook_event_name: "PostToolUse", tool_name: "Write" },
      { hook_event_name: "Stop" },
      "not json",
      "",
    ]) {
      const result = await runPause(payload, home);
      assert.equal(result.code, 0, JSON.stringify(payload));
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
    }

    const closed = await runPause(claudeWrite(COALESCE, "s"), home);
    assert.equal(JSON.parse(closed.stdout).hookSpecificOutput.permissionDecision, "allow");

    const dir = path.join(home, ".comprehension-guard");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "endpoint.json"), JSON.stringify({ port: 1, token: "tok" }));
    const refused = await runPause(claudeWrite(COALESCE, "s"), home);
    assert.equal(JSON.parse(refused.stdout).hookSpecificOutput.permissionDecision, "allow");
    assert.ok(refused.ms < 5_000);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a garbage editor reply and a dropped connection fail open without a quiz in the output", async () => {
  const home = fs.mkdtempSync(path.join(tmpdir(), "pause-garbage-"));
  const servers: Server[] = [];
  try {
    const garbage = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("nope");
    });
    servers.push(garbage);
    await new Promise<void>((resolve) => garbage.listen(0, "127.0.0.1", () => resolve()));
    const drop = createServer((req) => req.destroy());
    servers.push(drop);
    await new Promise<void>((resolve) => drop.listen(0, "127.0.0.1", () => resolve()));
    const dir = path.join(home, ".comprehension-guard");
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(
      path.join(dir, "endpoint.json"),
      JSON.stringify({ port: (garbage.address() as { port: number }).port, token: "tok" }),
    );
    const garbled = await runPause(claudeWrite(COALESCE, "s"), home);
    assert.equal(JSON.parse(garbled.stdout).hookSpecificOutput.permissionDecision, "allow");
    assert.equal(garbled.stdout.includes(COALESCE), false);

    fs.writeFileSync(
      path.join(dir, "endpoint.json"),
      JSON.stringify({ port: (drop.address() as { port: number }).port, token: "tok" }),
    );
    const dropped = await runPause(claudeWrite(COALESCE, "s"), home);
    assert.equal(JSON.parse(dropped.stdout).hookSpecificOutput.permissionDecision, "allow");
  } finally {
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("turning the gate off allows a due check without asking", async () => {
  let asks = 0;
  const session = new PauseSession(async () => {
    asks += 1;
    return false;
  });
  await session.noteFile("s", prefs("standard"), "/tmp/mm.js", COALESCE, {
    snippet: COALESCE,
    hunks: [{ newText: COALESCE }],
  });
  const decision = await session.onPause(claudeWrite(COALESCE, "s"), {
    enabled: false,
    preferences: prefs("standard"),
  });
  assert.equal(decision.allow, true);
  assert.equal(decision.reason, "continue");
  assert.equal(asks, 1, "the post-edit check can open, but a disabled pause does not wait on it");
});

test("quick pauses one chunk and picks ordering when the function has two branches", async () => {
  let asked: LocalQuestion[] = [];
  let release: (ok: boolean) => void = () => undefined;
  const quick = new PauseSession((questions) => {
    asked = questions;
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  await quick.noteFile("s", prefs("quick"), "/tmp/mm.js", COALESCE, {
    snippet: COALESCE,
    hunks: [{ newText: COALESCE }],
  });
  const pending = quick.onPause(claudeWrite("function next(bp) {\n  if (!bp) return 0;\n  return bp;\n}\n", "s"), {
    enabled: true,
    preferences: prefs("quick"),
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(asked.length, 1);
  assert.equal(asked[0]?.type, "ordering");
  release(true);
  const decision = await pending;
  assert.equal(decision.allow, true);
  assert.equal(decision.reason, "passed");
  assert.match(decision.agentMessage, /Preset quick/);
  assert.equal(decision.agentMessage.includes(COALESCE), false);
});

test("the model may send a whole file as one chunk, and the next chunk waits on one answer", async () => {
  const prompts: string[][] = [];
  let release: (ok: boolean) => void = () => undefined;
  const session = new PauseSession((questions) => {
    prompts.push(questions.map((question) => question.prompt));
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const two = `function first(bp) {
  if (!bp) return 0;
  return bp;
}
function second(bp) {
  if (!bp) return 1;
  return bp + 1;
}
`;
  const chosen = await session.onPause(claudeWrite(two, "s"), {
    enabled: true,
    preferences: prefs("quick"),
  });
  assert.equal(chosen.allow, true);
  assert.match(chosen.agentMessage, /whole file/);
  assert.equal(prompts.length, 0);

  await session.noteFile("s", prefs("quick"), "/tmp/mm.js", two, {
    snippet: two,
    hunks: [{ newText: two }],
  });
  const held = session.onPause(claudeWrite("function next(bp) {\n  if (!bp) return 0;\n  return bp;\n}\n", "s"), {
    enabled: true,
    preferences: prefs("quick"),
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(prompts.length, 1);
  release(true);
  const afterPass = await held;
  assert.equal(afterPass.allow, true);
  assert.equal(afterPass.reason, "passed");
  assert.match(afterPass.agentMessage, /You choose the next chunk/);
});
