import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  diffAddedText,
  editsFromHookEnvelope,
  equivalentText,
  generatedCode,
  isOurHookCommand,
  looksLikeAgentInvocation,
  isFreshEvent,
  parseApplyPatch,
  planHookInstall,
  prepareHeldEdit,
  quizSnippet,
  revertHunks,
  shouldQuizDiskBurst,
  shouldUseDiskFallback,
  withBaseline,
} from "../src/agentProtocol";
import {
  holdPath,
  isAgentClaimed,
  isCoveredByEditorGate,
  markEditorGate,
  releasePath,
  resetGateLock,
  snippetsMatch,
} from "../src/gateLock";

const NOTIFY = path.join(process.cwd(), "hook", "notify.js");
const THRESHOLD = 200;

test("claude code edit above the paste threshold is quizzed and can be reverted", () => {
  const oldText = "function greet() {\n  return 'hi';\n}\n";
  const newText = [
    "function greet(name) {",
    "  // Added by Claude Code. The caller must pass a display name.",
    "  const label = name.trim();",
    "  return 'Hello, ' + label;",
    "}",
    "",
  ].join("\n").padEnd(240, " ");
  assert.ok(newText.length >= THRESHOLD);

  const before = "const banner = true;\n" + oldText + "export { greet };\n";
  const after = before.replace(oldText, newText);
  const payload = {
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    cwd: "/work/app",
    tool_input: {
      file_path: "/work/app/src/greet.ts",
      old_string: oldText,
      new_string: newText,
    },
    tool_response: { filePath: "/work/app/src/greet.ts" },
  };

  const edits = editsFromHookEnvelope({ receivedAt: Date.now(), payload });
  assert.equal(edits.length, 1);
  assert.equal(edits[0].agent, "claude-code");
  assert.equal(edits[0].filePath, path.normalize("/work/app/src/greet.ts"));
  assert.equal(edits[0].snippet, newText);
  assert.ok(edits[0].snippet.length >= THRESHOLD);
  assert.equal(revertHunks(after, edits[0].hunks), before);
});

test("claude code write quizzes only the new lines when a snapshot exists", () => {
  const previous = "export const answer = 1;\n";
  const added = "export function explain() {\n  return 'adds the cached totals';\n}\n";
  assert.ok(added.length < THRESHOLD);
  const content = previous + added.repeat(6);
  const payload = {
    hook_event_name: "PostToolUse",
    tool_name: "Write",
    tool_input: { file_path: "/work/app/src/totals.ts", content },
    tool_response: { type: "update" },
  };
  const edits = editsFromHookEnvelope({
    snapshots: { "/work/app/src/totals.ts": previous },
    payload,
  });
  assert.equal(edits.length, 1);
  assert.ok(edits[0].snippet.length >= THRESHOLD);
  assert.ok(!edits[0].snippet.includes("export const answer"));
  assert.equal(edits[0].restore?.previous, previous);
  assert.equal(edits[0].restore?.next, content);
  assert.equal(edits[0].created, false);
});

test("a brand-new claude write is marked created and a tiny edit is below threshold", () => {
  const content = "export const value = 1;\n".padEnd(220, " ");
  const created = editsFromHookEnvelope({
    payload: {
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      tool_input: { file_path: "/work/app/src/new.ts", content },
      tool_response: { type: "create" },
    },
  });
  assert.equal(created[0].created, true);
  assert.equal(created[0].snippet, content);

  const tiny = editsFromHookEnvelope({
    payload: {
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: {
        file_path: "/work/app/src/new.ts",
        old_string: "a",
        new_string: "b".repeat(40),
      },
    },
  });
  assert.ok(tiny[0].snippet.length < THRESHOLD);
});

test("cursor cli quiz shows generated code, not the prompt, and can be inserted later", () => {
  const prompt = "Add a function named buildReceipt that explains the sale in detail";
  const generated = [
    "export function buildReceipt(price: number, quantity: number) {",
    "  const subtotal = price * quantity;",
    "  const tax = subtotal * 0.08;",
    "  const total = subtotal + tax;",
    "  return ['Subtotal ' + subtotal, 'Tax ' + tax, 'Total ' + total].join('\\n');",
    "}",
    "",
  ].join("\n").padEnd(240, " ");
  const before = "export const ready = true;\n";
  const after = before + generated;
  const [edit] = editsFromHookEnvelope({
    hook_event_name: "afterFileEdit",
    prompt,
    file_path: "/work/app/quiz-target.ts",
    edits: [{ old_string: prompt, new_string: prompt }],
  });
  assert.equal(edit.userPrompt, prompt);
  const held = prepareHeldEdit(edit, after, before);
  assert.ok(held.snippet.includes("buildReceipt"));
  assert.equal(held.snippet.includes(prompt), false);
  assert.ok(held.snippet.length >= THRESHOLD);
  assert.equal(held.restore?.previous, before);
  assert.equal(held.restore?.next, after);
});

test("a cursor cli command is not quizzed or written back as code", () => {
  const command = 'agent -p --force "Edit quiz-target.ts only. Add a function named buildReceipt that is longer than 200 characters."';
  const before = "export const ready = true;\n";
  const generated = [
    "export function buildReceipt(price: number, quantity: number) {",
    "  const subtotal = price * quantity;",
    "  const tax = subtotal * 0.08;",
    "  return subtotal + tax;",
    "}",
    "",
  ].join("\n").padEnd(240, " ");
  const after = before + generated;
  assert.equal(looksLikeAgentInvocation(command), true);
  assert.equal(generatedCode(command), "");

  const [edit] = editsFromHookEnvelope({
    hook_event_name: "afterFileEdit",
    file_path: "/work/app/quiz-target.ts",
    edits: [{ old_string: before, new_string: command }],
  });
  const held = prepareHeldEdit(edit, after, before);
  assert.ok(held.snippet.includes("function buildReceipt"));
  assert.equal(held.snippet.includes("agent -p"), false);
  assert.equal(held.restore?.next, after);
  assert.equal(held.restore?.previous, before);

  const onlyCommand = prepareHeldEdit(
    { ...edit, snippet: command, hunks: [{ oldText: before, newText: command }] },
    before + command,
    before,
  );
  assert.equal(onlyCommand.snippet, "");
});

test("bypass can insert generated cli code that is not in the file yet", () => {
  const before = "export const ready = true;\n";
  const generated = [
    "export function buildReceipt(price: number, quantity: number) {",
    "  const subtotal = price * quantity;",
    "  const tax = subtotal * 0.08;",
    "  return subtotal + tax;",
    "}",
    "",
  ].join("\n").padEnd(240, " ");
  const [edit] = editsFromHookEnvelope({
    hook_event_name: "afterFileEdit",
    file_path: "/work/app/quiz-target.ts",
    edits: [{ old_string: before, new_string: generated }],
  });
  const held = prepareHeldEdit(edit, before, before);
  assert.ok(held.snippet.includes("function buildReceipt"));
  assert.equal(held.restore?.previous, before);
  assert.ok(held.restore?.next.includes("function buildReceipt"));
  assert.equal(held.restore?.next.includes("export const ready"), false);
});

test("cursor afterFileEdit and codex apply_patch both normalize", () => {
  const replacement = "const port = 4312;\n".padEnd(240, " ");
  const cursor = editsFromHookEnvelope({
    file_path: "/work/app/src/server.ts",
    edits: [{ old_string: "const port = 3000;\n", new_string: replacement }],
  });
  assert.equal(cursor[0].agent, "cursor");
  assert.equal(cursor[0].snippet, replacement);
  assert.equal(
    revertHunks("const port = 3000;\n".replace("const port = 3000;\n", replacement), cursor[0].hunks),
    "const port = 3000;\n",
  );

  const patch = [
    "*** Begin Patch",
    "*** Update File: src/server.ts",
    "@@",
    "-const port = 3000;",
    "+" + replacement.trimEnd(),
    "*** Add File: src/extra.ts",
    "+export const extra = true;",
    "*** Delete File: src/gone.ts",
    "-export const gone = true;",
    "*** End Patch",
  ].join("\n");
  const parsed = parseApplyPatch(patch);
  assert.deepEqual(
    parsed.map((file) => file.kind),
    ["update", "add", "delete"],
  );
  const codex = editsFromHookEnvelope(
    {
      payload: {
        hook_event_name: "PostToolUse",
        tool_name: "apply_patch",
        cwd: "/work/app",
        tool_input: { command: patch },
      },
      snapshots: {
        "/work/app/src/server.ts": "const port = 3000;\n",
      },
    },
    {
      readFile: (filePath) =>
        filePath.endsWith("server.ts") ? "const port = 4312;\n" + "x".repeat(180) : "export const extra = true;\n",
    },
  );
  assert.equal(codex.length, 2);
  assert.equal(codex[0].agent, "codex");
  assert.ok(codex[0].restore);
  assert.equal(codex[1].created, true);
  assert.ok(codex.every((edit) => !edit.filePath.endsWith("gone.ts")));
});

test("non-edit tools and pre-tool events do not quiz", () => {
  assert.deepEqual(
    editsFromHookEnvelope({
      payload: {
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "ls" },
      },
    }),
    [],
  );
  assert.deepEqual(
    editsFromHookEnvelope({
      payload: { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: {} },
    }),
    [],
  );
});

test("open-file baseline turns a whole-file write into the added lines", () => {
  const previous = "a\n";
  const next = "a\n" + "added line that is part of the agent edit\n".repeat(8);
  const edit = withBaseline(
    {
      agent: "claude-code",
      filePath: "/work/app/src/a.ts",
      snippet: next,
      hunks: [],
      next,
      created: true,
    },
    previous,
  );
  assert.equal(edit.created, false);
  assert.ok(edit.snippet.startsWith("added line"));
  assert.equal(edit.restore?.previous, previous);
  assert.equal(diffAddedText(previous, next), edit.snippet);
  assert.equal(diffAddedText("same\n", "same\n"), "");
  assert.equal(equivalentText("a\r\nb\n", "a\nb"), true);
});

test("disk fallback ignores focused single insertions, typing, and bulk checkouts", () => {
  const base = {
    suppressed: false,
    processing: false,
    claimed: false,
    undoOrRedo: false,
    ignoredPath: false,
    isActive: true,
    isDirty: false,
    bigSingle: false,
    totalInserted: 400,
    threshold: THRESHOLD,
    hasBaseline: true,
  };
  assert.equal(shouldUseDiskFallback({ ...base, bigSingle: true }), false);
  assert.equal(shouldUseDiskFallback({ ...base, isDirty: true }), false);
  assert.equal(shouldUseDiskFallback(base), false, "the focused editor is not a disk write");
  assert.equal(shouldUseDiskFallback({ ...base, isActive: false, isDirty: true }), true);
  assert.equal(shouldUseDiskFallback({ ...base, totalInserted: 20 }), false);
  assert.equal(shouldUseDiskFallback({ ...base, hasBaseline: false }), false);
  assert.equal(shouldUseDiskFallback({ ...base, claimed: true }), false);
  assert.equal(shouldUseDiskFallback({ ...base, undoOrRedo: true }), false);
  assert.equal(shouldUseDiskFallback({ ...base, ignoredPath: true }), false);
  assert.equal(shouldQuizDiskBurst(3), true);
  assert.equal(shouldQuizDiskBurst(4), false);
  assert.equal(quizSnippet("x".repeat(30_000)).length, 24_000);
});

function installedConfigs(writes: { path: string; contents: string }[]) {
  const read = (needle: string) => {
    const write = writes.find((item) => item.path.includes(needle));
    if (!write) {
      throw new Error("missing " + needle);
    }
    return { kind: "ok" as const, value: JSON.parse(write.contents) };
  };
  return {
    claude: read(`${path.sep}.claude${path.sep}`),
    codex: read(`${path.sep}.codex${path.sep}`),
    cursor: read(`${path.sep}.cursor${path.sep}`),
    gemini: read(`${path.sep}.gemini${path.sep}settings.json`),
    copilot: read(`${path.sep}.copilot${path.sep}`),
    droid: read(`${path.sep}.factory${path.sep}`),
    goose: read(`comprehension-guard${path.sep}hooks${path.sep}`),
    antigravity: read(`${path.sep}.gemini${path.sep}config${path.sep}`),
  };
}

test("hook install merges without dropping existing hooks and is idempotent", () => {
  const home = path.join("/tmp", "guard-home");
  const nodePath = "/usr/local/bin/node";
  const script = "// notifier\n";
  const claude = {
    theme: "dark",
    hooks: {
      Notification: [{ matcher: "", hooks: [{ type: "command", command: "echo hi" }] }],
    },
  };
  const first = planHookInstall({
    homeDir: home,
    nodePath,
    scriptSource: script,
    claude: { kind: "ok", value: claude },
    codex: { kind: "missing" },
    cursor: {
      kind: "ok",
      value: { version: 1, hooks: { sessionStart: [{ command: "echo start" }] } },
    },
  });
  assert.deepEqual(first.installed.sort(), [
    "Antigravity",
    "Claude Code",
    "Codex",
    "Copilot CLI",
    "Cursor",
    "Droid",
    "Gemini CLI",
    "Goose",
  ]);
  assert.deepEqual(first.errors, []);
  const claudeWrite = first.writes.find((write) => write.path.endsWith(`${path.sep}.claude${path.sep}settings.json`));
  const codexWrite = first.writes.find((write) => write.path.endsWith(`${path.sep}.codex${path.sep}hooks.json`));
  const cursorWrite = first.writes.find((write) => write.path.endsWith(`${path.sep}.cursor${path.sep}hooks.json`));
  const geminiWrite = first.writes.find((write) => write.path.endsWith(`${path.sep}.gemini${path.sep}settings.json`));
  assert.ok(claudeWrite && codexWrite && cursorWrite && geminiWrite);
  const claudeJson = JSON.parse(claudeWrite.contents);
  assert.equal(claudeJson.theme, "dark");
  assert.equal(claudeJson.hooks.Notification[0].hooks[0].command, "echo hi");
  assert.ok(claudeJson.hooks.PostToolUse[0].hooks[0].async);
  assert.equal(claudeJson.hooks.PreToolUse[0].hooks[0].async, undefined);
  assert.match(claudeJson.hooks.PostToolUse[0].matcher, /Edit\|Write/);
  const cursorJson = JSON.parse(cursorWrite.contents);
  assert.equal(cursorJson.hooks.sessionStart[0].command, "echo start");
  assert.match(cursorJson.hooks.afterFileEdit[0].command, /notify\.js/);

  const second = planHookInstall({
    homeDir: home,
    nodePath,
    scriptSource: script,
    ...installedConfigs(first.writes),
  });
  assert.deepEqual(second.installed, []);
  assert.deepEqual(second.unchanged.sort(), [
    "Antigravity",
    "Claude Code",
    "Codex",
    "Copilot CLI",
    "Cursor",
    "Droid",
    "Gemini CLI",
    "Goose",
  ]);
  assert.deepEqual(
    second.writes.map((write) => path.basename(write.path)).sort(),
    ["notify.js", "plugin.json"],
  );

  const invalid = planHookInstall({
    homeDir: home,
    nodePath,
    scriptSource: script,
    claude: { kind: "invalid", reason: "bad" },
    codex: { kind: "missing" },
    cursor: { kind: "missing" },
  });
  assert.equal(invalid.errors.length, 1);
  assert.ok(!invalid.writes.some((write) => write.path.includes(`${path.sep}.claude${path.sep}`)));
});

test("pause hook is added beside notify and a second install is idempotent", () => {
  const home = path.join("/tmp", "guard-home-pause");
  const nodePath = "/usr/local/bin/node";
  const script = "// notifier\n";
  const pause = "// pause\n";
  const first = planHookInstall({
    homeDir: home,
    nodePath,
    scriptSource: script,
    pauseSource: pause,
    claude: { kind: "missing" },
    codex: { kind: "missing" },
    cursor: { kind: "missing" },
  });
  assert.deepEqual(first.installed.sort(), [
    "Antigravity",
    "Claude Code",
    "Codex",
    "Copilot CLI",
    "Cursor",
    "Droid",
    "Gemini CLI",
    "Goose",
  ]);
  const claudeWrite = first.writes.find((write) => write.path.endsWith(`${path.sep}.claude${path.sep}settings.json`));
  const codexWrite = first.writes.find((write) => write.path.endsWith(`${path.sep}.codex${path.sep}hooks.json`));
  const cursorWrite = first.writes.find((write) => write.path.endsWith(`${path.sep}.cursor${path.sep}hooks.json`));
  const pauseWrite = first.writes.find((write) => write.path.endsWith(`${path.sep}pause.js`));
  assert.ok(claudeWrite && codexWrite && cursorWrite && pauseWrite);
  assert.equal(pauseWrite.contents, pause);

  const claudeJson = JSON.parse(claudeWrite.contents);
  const pre = claudeJson.hooks.PreToolUse[0];
  assert.equal(pre.matcher, "Edit|Write|NotebookEdit|MultiEdit");
  assert.equal(pre.hooks.length, 2);
  assert.match(pre.hooks[0].command, /notify\.js/);
  assert.equal(pre.hooks[0].async, undefined);
  assert.equal(pre.hooks[0].timeout, 10);
  assert.match(pre.hooks[1].command, /pause\.js/);
  assert.equal(pre.hooks[1].async, undefined);
  assert.equal(pre.hooks[1].timeout, 600);
  assert.equal(claudeJson.hooks.PostToolUse[0].hooks.length, 1);
  assert.match(claudeJson.hooks.PostToolUse[0].hooks[0].command, /notify\.js/);
  assert.equal(isOurHookCommand(pre.hooks[0].command), true);
  assert.equal(isOurHookCommand(pre.hooks[1].command), true);
  assert.equal(isOurHookCommand("echo hi"), false);

  const codexJson = JSON.parse(codexWrite.contents);
  const codexPre = codexJson.hooks.PreToolUse[0];
  assert.equal(codexPre.matcher, "apply_patch|Edit|Write");
  assert.equal(codexPre.hooks.length, 2);
  assert.match(codexPre.hooks[0].command, /notify\.js/);
  assert.match(codexPre.hooks[1].command, /pause\.js/);
  assert.equal(codexPre.hooks[1].timeout, 600);
  assert.equal(codexPre.hooks[1].async, undefined);
  assert.equal(codexJson.hooks.PostToolUse[0].hooks.length, 1);

  const cursorJson = JSON.parse(cursorWrite.contents);
  assert.match(cursorJson.hooks.afterFileEdit[0].command, /notify\.js/);
  assert.equal(cursorJson.hooks.preToolUse.length, 1);
  assert.match(cursorJson.hooks.preToolUse[0].command, /pause\.js/);
  assert.equal(cursorJson.hooks.preToolUse[0].timeout, 600);
  assert.equal(cursorJson.hooks.preToolUse[0].command.includes("notify.js"), false);

  const second = planHookInstall({
    homeDir: home,
    nodePath,
    scriptSource: script,
    pauseSource: pause,
    ...installedConfigs(first.writes),
  });
  assert.deepEqual(second.installed, []);
  assert.deepEqual(second.unchanged.sort(), [
    "Antigravity",
    "Claude Code",
    "Codex",
    "Copilot CLI",
    "Cursor",
    "Droid",
    "Gemini CLI",
    "Goose",
  ]);
  assert.deepEqual(
    second.writes.map((write) => path.basename(write.path)).sort(),
    ["notify.js", "pause.js", "plugin.json"],
  );
});

test("a Gemini CLI AfterTool write becomes one edit and a BeforeTool does not", () => {
  const source = "function coalesce(bp) {\n  if (!bp) return 0;\n  return bp;\n}\n";
  const after = editsFromHookEnvelope({
    payload: {
      hook_event_name: "AfterTool",
      session_id: "g",
      cwd: "/tmp",
      tool_name: "write_file",
      tool_input: { file_path: "/tmp/mm.js", content: source },
    },
  });
  assert.equal(after.length, 1);
  assert.equal(after[0]?.agent, "gemini");
  assert.equal(after[0]?.filePath.endsWith("mm.js"), true);
  assert.equal(after[0]?.snippet, source);
  assert.deepEqual(
    editsFromHookEnvelope({
      payload: {
        hook_event_name: "BeforeTool",
        tool_name: "write_file",
        tool_input: { file_path: "/tmp/mm.js", content: source },
      },
    }),
    [],
  );
  const replaced = editsFromHookEnvelope({
    payload: {
      hook_event_name: "AfterTool",
      tool_name: "replace",
      tool_input: {
        file_path: "/tmp/mm.js",
        old_string: "return 0;",
        new_string: "return 1;",
        allow_multiple: true,
      },
    },
  });
  assert.equal(replaced[0]?.agent, "gemini");
  assert.equal(replaced[0]?.hunks[0]?.replaceAll, true);
  assert.equal(looksLikeAgentInvocation("gemini fix the parser"), true);
});

test("stale inbox events and overlapping gates are ignored", () => {
  const now = 1_700_000_000_000;
  assert.equal(isFreshEvent(now - 1000, now), true);
  assert.equal(isFreshEvent(now - 10 * 60 * 1000, now), false);
  resetGateLock();
  markEditorGate("/work/app/src/a.ts", "x".repeat(50));
  assert.equal(isAgentClaimed("/work/app/src/a.ts"), true);
  assert.equal(isCoveredByEditorGate("/work/app/src/a.ts", "x".repeat(50)), true);
  assert.equal(snippetsMatch("x".repeat(50), "yyyy"), false);
  assert.equal(isCoveredByEditorGate("/work/app/src/a.ts", "y".repeat(80)), false);
  releasePath("/work/app/src/a.ts");
  holdPath("/work/app/src/b.ts");
  assert.equal(isAgentClaimed("/work/app/src/b.ts"), true);
  releasePath("/work/app/src/b.ts");
  assert.equal(isAgentClaimed("/work/app/src/b.ts"), true);
  resetGateLock();
});

test("notifier posts a claude edit and queues it when the editor is down", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "guard-hook-"));
  const project = path.join(home, "project");
  const filePath = path.join(project, "src", "greet.ts");
  await mkdir(path.dirname(filePath), { recursive: true });
  const oldText = "function greet() {\n  return 'hi';\n}\n";
  const newText = "function greet(name) {\n  const label = name.trim();\n  return 'Hello, ' + label;\n}\n".padEnd(240, " ");
  const original = "header\n" + oldText;
  await writeFile(filePath, original, "utf8");

  await runNotify(home, {
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    cwd: project,
    tool_input: { file_path: filePath, old_string: oldText, new_string: newText },
  });
  const after = original.replace(oldText, newText);
  await writeFile(filePath, after, "utf8");

  const received: unknown[] = [];
  const server = await listen((body) => received.push(body));
  await writeFile(
    path.join(home, ".comprehension-guard", "endpoint.json"),
    JSON.stringify({ port: server.port, token: "secret-token" }),
    "utf8",
  );
  await runNotify(home, {
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    cwd: project,
    tool_input: { file_path: filePath, old_string: oldText, new_string: newText },
  });
  assert.equal(received.length, 1);
  const edits = editsFromHookEnvelope(received[0]);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].agent, "claude-code");
  assert.equal(edits[0].snippet, newText);
  assert.ok(edits[0].snippet.length >= THRESHOLD);
  assert.equal(revertHunks(after, edits[0].hunks), original);
  const envelope = received[0] as { snapshots: Record<string, string> };
  assert.equal(envelope.snapshots[path.resolve(filePath)], original);

  server.hitStatus = 401;
  await runNotify(home, {
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    cwd: project,
    tool_input: { file_path: filePath, old_string: oldText, new_string: newText },
  });
  const inbox = path.join(home, ".comprehension-guard", "inbox");
  const names = await readdir(inbox);
  assert.equal(names.length, 1);
  const queued = JSON.parse(await readFile(path.join(inbox, names[0]), "utf8"));
  assert.equal(editsFrom(queued)[0].snippet, newText);
  assert.equal(isFreshEvent(queued.receivedAt, Date.now()), true);

  await closeServer(server.server);
  await rm(home, { recursive: true, force: true });
});

function editsFrom(body: unknown) {
  return editsFromHookEnvelope(body);
}

function runNotify(home: string, payload: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [NOTIFY], {
      env: { ...process.env, COMPREHENSION_GUARD_HOME: home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error("notify exited " + code + ": " + stderr));
        return;
      }
      resolve();
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function listen(onBody: (body: unknown) => void): Promise<{ port: number; server: Server; hitStatus: number }> {
  const state = { port: 0, server: undefined as Server | undefined, hitStatus: 204 };
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk as Buffer));
      req.on("end", () => {
        const token = req.headers["x-guard-token"];
        if (token !== "secret-token" || state.hitStatus !== 204) {
          res.writeHead(state.hitStatus === 204 ? 401 : state.hitStatus);
          res.end();
          return;
        }
        onBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        res.writeHead(204);
        res.end();
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no port"));
        return;
      }
      state.port = addr.port;
      state.server = server;
      resolve(state as { port: number; server: Server; hitStatus: number });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
