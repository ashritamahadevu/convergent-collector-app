/**
 * Replays hook payloads captured from a REAL Claude Code run
 * (test/fixtures/claude-code/<version>/*.json, produced by
 * test/claude-live/run-scenario.ts + make-fixtures.ts) through the parser
 * and through hook/notify.js.
 *
 * Tests marked { todo: "BUG-..." } assert intended behavior that currently
 * fails; they are reported as TODO, not as suite failures.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  EVENT_MAX_AGE_MS,
  editsFromHookEnvelope,
  isFreshEvent,
  planHookInstall,
  prepareHeldEdit,
  quizSnippet,
  revertHunks,
  snapshotFileName,
  withBaseline,
} from "../src/agentProtocol";

const VERSION = "2.1.316";
const FIXTURES = path.join(__dirname, "fixtures", "claude-code", VERSION);
const NOTIFY = path.join(__dirname, "..", "hook", "notify.js");
const THRESHOLD = 200;

type Fixture = {
  claudeVersion: string;
  hookEvents: { t: number; payload: Record<string, any> }[];
  delivered: { via: string; t: number; envelope: Record<string, any> }[];
  finalFiles: Record<string, string>;
  seed: Record<string, string>;
};

/** Load a fixture and point its placeholder paths at a fresh temp project. */
function load(name: string) {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, name + ".json"), "utf8")) as Fixture;
  const root = fs.mkdtempSync(path.join(tmpdir(), "cg fixture "));
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  const fix = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (!value.includes("__PROJECT__") && !value.includes("__GUARD_HOME__")) {
        return value;
      }
      let s = value.split("__PROJECT__").join(project).split("__GUARD_HOME__").join(home);
      if (process.platform !== "win32") {
        s = s.replace(/\\/g, "/");
      }
      return s;
    }
    if (Array.isArray(value)) {
      return value.map(fix);
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [fix(k) as string, fix(v)]));
    }
    return value;
  };
  const f = fix(raw) as Fixture;
  const writeTree = (files: Record<string, string>): void => {
    for (const [rel, text] of Object.entries(files)) {
      const abs = path.join(project, rel.replace(/\\/g, path.sep));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text);
    }
  };
  return {
    ...f,
    root,
    project,
    home,
    writeSeed: () => writeTree(f.seed),
    writeFinal: () => writeTree(f.finalFiles),
    abs: (rel: string) => path.join(project, rel),
    posts: (tool?: string) =>
      f.hookEvents.filter((e) => e.payload.hook_event_name === "PostToolUse" && (!tool || e.payload.tool_name === tool)),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function readFile(abs: string): string | undefined {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return undefined;
  }
}

test("fixtures were captured from the Claude Code version under test", () => {
  for (const name of fs.readdirSync(FIXTURES)) {
    const f = JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));
    assert.match(f.claudeVersion, new RegExp("^" + VERSION.replace(/\./g, "\\.")));
  }
});

test("hook config from planHookInstall: matcher, async PostToolUse, timeout, quoted paths with spaces", () => {
  const plan = planHookInstall({
    homeDir: "C:\\Users\\Some One\\guard home (x86)",
    nodePath: "C:\\Program Files\\nodejs\\node.exe",
    scriptSource: "//",
    claude: { kind: "missing" },
    codex: { kind: "missing" },
    cursor: { kind: "missing" },
  });
  const settings = JSON.parse(plan.writes.find((w) => w.path.endsWith("settings.json") && w.path.includes(".claude"))!.contents);
  const pre = settings.hooks.PreToolUse[0];
  const post = settings.hooks.PostToolUse[0];
  assert.equal(pre.matcher, "Edit|Write|NotebookEdit|MultiEdit");
  assert.equal(post.matcher, "Edit|Write|NotebookEdit|MultiEdit");
  assert.equal(pre.hooks[0].async, undefined, "PreToolUse must be synchronous so the snapshot exists before the write");
  assert.equal(post.hooks[0].async, true);
  assert.equal(post.hooks[0].timeout, 10);
  assert.equal(
    post.hooks[0].command,
    '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\Some One\\guard home (x86)\\.comprehension-guard\\notify.js"',
  );
  // Claude Code 2.1.316 exposes no MultiEdit tool, and edits through Bash / PowerShell never match.
  const re = new RegExp("^(?:" + post.matcher + ")$");
  for (const tool of ["Edit", "Write", "NotebookEdit"]) {
    assert.ok(re.test(tool), tool);
  }
  for (const tool of ["Bash", "PowerShell"]) {
    assert.ok(!re.test(tool), tool);
  }
});

test("real Edit payloads: small edit stays under the threshold, large edit parses, reverts, and re-applies", () => {
  const f = load("edit-twice");
  try {
    const delivered = f.delivered.map((d) => d.envelope);
    assert.equal(delivered.length, 2, "both edits to the same file were delivered, in order");
    assert.ok(delivered[0].receivedAt < delivered[1].receivedAt);
    const [small] = editsFromHookEnvelope(delivered[0]);
    const [large] = editsFromHookEnvelope(delivered[1]);
    assert.equal(small.filePath, f.abs("app.js"));
    assert.ok(quizSnippet(small.snippet).length < THRESHOLD, "the 'hi' -> 'hello' edit is not quizzed");
    assert.equal(large.agent, "claude-code");
    assert.equal(large.filePath, f.abs("app.js"));
    assert.ok(quizSnippet(large.snippet).length >= THRESHOLD);
    assert.equal(large.hunks[0].oldText, "// TODO: add helpers");

    const response = delivered[1].payload.tool_response;
    const finalText = f.finalFiles["app.js"];
    // Reverting the hunk from the final file gives the file Claude saw before edit 2.
    assert.equal(revertHunks(finalText, large.hunks), response.originalFile);
    const held = prepareHeldEdit(large, finalText, undefined);
    assert.equal(held.restore?.previous, response.originalFile);
    assert.equal(held.restore?.next, finalText);
    // The envelope carries the PreToolUse snapshot of the file before edit 2.
    assert.equal(Object.values(delivered[1].snapshots)[0], response.originalFile);
  } finally {
    f.cleanup();
  }
});

test("real Write payloads: new file is 'created', overwrite uses the PreToolUse snapshot", () => {
  const f = load("write-new-overwrite");
  try {
    f.writeFinal();
    const [created] = editsFromHookEnvelope(f.delivered[0].envelope, { readFile });
    assert.equal(created.filePath, f.abs(path.join("utils", "strings.js")));
    assert.equal(created.created, true);
    assert.equal(created.next, f.finalFiles[path.join("utils", "strings.js")] ?? f.finalFiles["utils\\strings.js"]);
    assert.equal(f.delivered[0].envelope.payload.tool_response.type, "create");

    const [over] = editsFromHookEnvelope(f.delivered[1].envelope, { readFile });
    assert.equal(over.filePath, f.abs("config.js"));
    assert.equal(over.created, false);
    assert.equal(over.restore?.previous, f.seed["config.js"]);
    assert.equal(over.restore?.next, f.finalFiles["config.js"]);
    assert.equal(f.delivered[1].envelope.payload.tool_response.type, "update");
    assert.ok(over.snippet.length >= THRESHOLD);
  } finally {
    f.cleanup();
  }
});

test("real NotebookEdit payload is detected", () => {
  const f = load("notebook");
  try {
    const env = f.delivered[0].envelope;
    const [edit] = editsFromHookEnvelope(env);
    assert.equal(edit.filePath, f.abs("analysis.ipynb"));
    assert.ok(quizSnippet(edit.snippet).length >= THRESHOLD);
    assert.equal(edit.snippet, env.payload.tool_input.new_source);
  } finally {
    f.cleanup();
  }
});

test("a NotebookEdit is revertible to the original notebook", () => {
  const f = load("notebook");
  try {
    const env = f.delivered[0].envelope;
    const [edit] = editsFromHookEnvelope(env);
    const updated = env.payload.tool_response.updated_file as string;
    const held = prepareHeldEdit(withBaseline(edit, undefined), updated, undefined);
    assert.ok(held.restore, "no restore point means a failed check cannot remove the code");
    assert.equal(held.restore!.previous, env.payload.tool_response.original_file);
  } finally {
    f.cleanup();
  }
});

test("NotebookEdit keeps old_source and the original file for a revert", () => {
  const f = load("notebook");
  try {
    const env = f.delivered[0].envelope;
    const [edit] = editsFromHookEnvelope(env);
    const updated = env.payload.tool_response.updated_file as string;
    assert.equal(edit.hunks[0].oldText, env.payload.tool_response.old_source);
    assert.equal(edit.restore?.previous, env.payload.tool_response.original_file);
    assert.equal(edit.restore?.next, updated);
    const held = prepareHeldEdit(edit, updated, undefined);
    assert.equal(held.restore?.previous, env.payload.tool_response.original_file);
  } finally {
    f.cleanup();
  }
});

test("real Bash edits never reach the notifier (matcher excludes Bash) and would parse to nothing", () => {
  const f = load("bash-edits");
  try {
    assert.equal(f.delivered.length, 0);
    const bash = f.posts("Bash");
    assert.equal(bash.length, 3);
    for (const e of bash) {
      assert.deepEqual(editsFromHookEnvelope({ receivedAt: 0, snapshots: {}, payload: e.payload }), []);
    }
    assert.match(f.finalFiles["app.js"], /sumSquares/, "the Bash edits did land on disk");
  } finally {
    f.cleanup();
  }
});

test("relative paths: Claude 2.1.316 sends absolute paths even when told to use a relative one; parser resolves relative against cwd", () => {
  const f = load("relative-inbox");
  try {
    const env = f.delivered[0].envelope;
    assert.equal(f.delivered[0].via, "inbox");
    assert.ok(path.isAbsolute(env.payload.tool_input.file_path));
    const relative = JSON.parse(JSON.stringify(env));
    relative.payload.tool_input.file_path = "src/rel.js";
    const [edit] = editsFromHookEnvelope(relative);
    assert.equal(edit.filePath, f.abs(path.join("src", "rel.js")));
  } finally {
    f.cleanup();
  }
});

test("inbox freshness window is 3 minutes from receivedAt", () => {
  const f = load("relative-inbox");
  try {
    const at = 1_800_000_000_000;
    assert.equal(EVENT_MAX_AGE_MS, 180_000);
    assert.ok(isFreshEvent(at, at + 179_999));
    assert.ok(isFreshEvent(at, at + 180_000));
    assert.ok(!isFreshEvent(at, at + 180_001));
    assert.ok(isFreshEvent(at + 59_000, at), "a little clock skew is tolerated");
    assert.ok(!isFreshEvent(at + 61_000, at));
    assert.equal(typeof f.delivered[0].envelope.receivedAt, "number");
  } finally {
    f.cleanup();
  }
});

test("Windows paths with spaces round-trip from the real payload", () => {
  const f = load("spaces");
  try {
    const [edit] = editsFromHookEnvelope(f.delivered[0].envelope);
    assert.equal(edit.filePath, f.abs("my module.js"));
    f.writeFinal();
    const [write] = editsFromHookEnvelope(f.delivered[1].envelope, { readFile });
    assert.equal(write.filePath, f.abs(path.join("sub dir", "new file.js")));
    assert.equal(write.created, true);
  } finally {
    f.cleanup();
  }
});

test("observed: 8 Writes issued in ONE assistant message still arrive ~1.5s apart, wider than the 700ms batch window", () => {
  const f = load("parallel-writes");
  try {
    assert.equal(f.delivered.length, 8);
    const times = f.delivered.map((d) => d.envelope.receivedAt as number).sort((a, b) => a - b);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    assert.ok(Math.min(...gaps) > 700, "gaps " + gaps.join(","));
    for (const d of f.delivered) {
      const [edit] = editsFromHookEnvelope(d.envelope, { readFile: () => undefined });
      assert.equal(edit.created, true);
    }
  } finally {
    f.cleanup();
  }
});

test("observed: when the endpoint accepts but never answers, the same event is delivered twice (HTTP + inbox)", () => {
  const f = load("blackhole");
  try {
    assert.deepEqual(f.delivered.map((d) => d.via).sort(), ["http", "inbox"]);
    assert.equal(f.delivered[0].envelope.receivedAt, f.delivered[1].envelope.receivedAt);
    assert.ok(Math.abs(f.delivered[1].t - f.delivered[0].t) >= 1400);
  } finally {
    f.cleanup();
  }
});

// ---- hook/notify.js with the real payloads ----

function runNotify(payload: unknown, home: string): Promise<{ code: number; stdout: string; stderr: string; ms: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [NOTIFY], {
      env: { ...process.env, COMPREHENSION_GUARD_HOME: home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => resolve({ code: code ?? -1, stdout, stderr, ms: Date.now() - started }));
    child.stdin.end(JSON.stringify(payload));
  });
}

test("notify.js on real PreToolUse/PostToolUse payloads: silent, exit 0, snapshot then inbox", async () => {
  const f = load("edit-twice");
  try {
    f.writeSeed();
    const events = f.hookEvents.filter((e) => e.payload.tool_name === "Edit");
    const pre = events.find((e) => e.payload.hook_event_name === "PreToolUse")!;
    const post = events.find((e) => e.payload.hook_event_name === "PostToolUse")!;
    const r1 = await runNotify(pre.payload, f.home);
    assert.deepEqual([r1.code, r1.stdout, r1.stderr], [0, "", ""]);
    const snap = path.join(f.home, ".comprehension-guard", "snapshots", snapshotFileName(f.abs("app.js")));
    assert.equal(fs.readFileSync(snap, "utf8"), f.seed["app.js"]);
    assert.equal(
      path.basename(snap),
      createHash("sha1").update(path.resolve(f.abs("app.js"))).digest("hex") + ".txt",
      "notify.js and the extension agree on the snapshot name",
    );

    const r2 = await runNotify(post.payload, f.home);
    assert.deepEqual([r2.code, r2.stdout, r2.stderr], [0, "", ""]);
    const inbox = path.join(f.home, ".comprehension-guard", "inbox");
    const files = fs.readdirSync(inbox);
    assert.equal(files.length, 1);
    const env = JSON.parse(fs.readFileSync(path.join(inbox, files[0]), "utf8"));
    assert.equal(env.payload.tool_use_id, post.payload.tool_use_id);
    assert.equal(Object.values(env.snapshots)[0], f.seed["app.js"]);
    assert.ok(r2.ms < 3000, "no endpoint: returns quickly (" + r2.ms + "ms)");
  } finally {
    f.cleanup();
  }
});

test("notify.js with a stale endpoint.json (closed port) falls back to the inbox quickly", async () => {
  const f = load("edit-twice");
  try {
    const dir = path.join(f.home, ".comprehension-guard");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "endpoint.json"), JSON.stringify({ port: 1, token: "x", pid: 1 }));
    const post = f.posts("Edit")[1];
    const r = await runNotify(post.payload, f.home);
    assert.deepEqual([r.code, r.stdout], [0, ""]);
    assert.equal(fs.readdirSync(path.join(dir, "inbox")).length, 1);
    assert.ok(r.ms < 3000, r.ms + "ms");
  } finally {
    f.cleanup();
  }
});

test("notify.js against an endpoint that never answers: waits ~1.5s, exits 0, and ALSO writes the inbox (duplicate)", async () => {
  const f = load("edit-twice");
  let server: Server | undefined;
  try {
    let got = 0;
    server = createServer((req) => {
      req.on("data", () => {});
      req.on("end", () => {
        got += 1;
      });
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    const dir = path.join(f.home, ".comprehension-guard");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "endpoint.json"), JSON.stringify({ port, token: "t", pid: 1 }));
    const r = await runNotify(f.posts("Edit")[1].payload, f.home);
    assert.deepEqual([r.code, r.stdout], [0, ""]);
    assert.ok(r.ms >= 1400 && r.ms < 5000, r.ms + "ms");
    assert.equal(got, 1, "server received the body");
    assert.equal(fs.readdirSync(path.join(dir, "inbox")).length, 1, "and the inbox got a copy too");
  } finally {
    server?.close();
    f.cleanup();
  }
});
