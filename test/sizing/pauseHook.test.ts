/**
 * Spawns hook/pause.js the same way claudeCodePayloads.test.ts runs notify.js.
 * COMPREHENSION_GUARD_HOME points at a temp directory, never the real home.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const PAUSE = path.join(__dirname, "..", "..", "hook", "pause.js");

function runPause(
  payload: unknown,
  home: string,
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [PAUSE], {
      env: { ...process.env, COMPREHENSION_GUARD_HOME: home, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(typeof payload === "string" ? payload : JSON.stringify(payload));
  });
}

function tempHome(): string {
  return fs.mkdtempSync(path.join(tmpdir(), "pause-hook-"));
}

test("PreToolUse Read allows without contacting the editor", async () => {
  const home = tempHome();
  try {
    const result = await runPause(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: "/tmp/a.ts" },
      },
      home,
    );
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    });
    assert.equal(fs.existsSync(path.join(home, ".comprehension-guard", "endpoint.json")), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("PreToolUse Write with no endpoint.json allows because the editor is closed", async () => {
  const home = tempHome();
  try {
    const result = await runPause(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: "/tmp/a.ts", content: "export const n = 1;\n" },
      },
      home,
    );
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("PreToolUse Write denies when the editor answers allow false", async () => {
  const home = tempHome();
  let server: Server | undefined;
  try {
    let got: unknown;
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk as Buffer));
      req.on("end", () => {
        assert.equal(req.url, "/pause");
        assert.equal(req.headers["x-guard-token"], "tok");
        got = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            allow: false,
            reason: "failed",
            userMessage: "u",
            agentMessage: "stop",
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as { port: number }).port;
    const dir = path.join(home, ".comprehension-guard");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "endpoint.json"), JSON.stringify({ port, token: "tok" }));
    const result = await runPause(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: "/tmp/a.ts" },
      },
      home,
    );
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "stop",
      },
    });
    const body = got as { kind?: string; payload?: { tool_name?: string } };
    assert.equal(body.kind, "pause");
    assert.equal(body.payload?.tool_name, "Write");
  } finally {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("Gemini BeforeTool read_file allows without contacting the editor", async () => {
  const home = tempHome();
  try {
    const result = await runPause(
      {
        hook_event_name: "BeforeTool",
        tool_name: "read_file",
        tool_input: { file_path: "/tmp/a.ts" },
      },
      home,
    );
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), { decision: "allow" });
    assert.equal(fs.existsSync(path.join(home, ".comprehension-guard", "endpoint.json")), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("Gemini BeforeTool write_file denies with a reason and AfterTool prints nothing", async () => {
  const home = tempHome();
  let server: Server | undefined;
  try {
    server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          allow: false,
          reason: "one-chunk",
          userMessage: "Write one function at a time.",
          agentMessage: "Write one chunk only.",
        }),
      );
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const dir = path.join(home, ".comprehension-guard");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "endpoint.json"),
      JSON.stringify({ port: (server.address() as { port: number }).port, token: "tok" }),
    );
    const denied = await runPause(
      {
        hook_event_name: "BeforeTool",
        session_id: "g",
        tool_name: "write_file",
        tool_input: { file_path: "/tmp/a.ts", content: "function a(){ if (x) return 1; }\n" },
      },
      home,
    );
    assert.equal(denied.code, 0);
    assert.equal(denied.stderr, "");
    assert.deepEqual(JSON.parse(denied.stdout), { decision: "deny", reason: "Write one chunk only." });
    assert.equal(denied.stdout.includes("function a"), false);

    const after = await runPause(
      { hook_event_name: "AfterTool", tool_name: "write_file", tool_input: { content: "function a(){}" } },
      home,
    );
    assert.equal(after.code, 0);
    assert.equal(after.stdout, "");
  } finally {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("Copilot, Goose, and Antigravity pauses use each host's decision shape", async () => {
  const home = tempHome();
  let server: Server | undefined;
  try {
    server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ allow: false, reason: "failed", userMessage: "u", agentMessage: "wait" }));
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const dir = path.join(home, ".comprehension-guard");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "endpoint.json"),
      JSON.stringify({ port: (server.address() as { port: number }).port, token: "tok" }),
    );
    const copilot = await runPause(
      { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "/tmp/a.ts", content: "x" } },
      home,
      { COMPREHENSION_GUARD_AGENT: "copilot" },
    );
    assert.deepEqual(JSON.parse(copilot.stdout), { permissionDecision: "deny", permissionDecisionReason: "wait" });
    const goose = await runPause(
      { event: "PreToolUse", tool_name: "write", tool_input: { path: "/tmp/a.ts", content: "x" } },
      home,
      { COMPREHENSION_GUARD_AGENT: "goose" },
    );
    assert.deepEqual(JSON.parse(goose.stdout), { decision: "block", reason: "wait" });
    const antigravity = await runPause(
      { toolCall: { name: "write_to_file", args: { TargetFile: "/tmp/a.ts", CodeContent: "x" } } },
      home,
      { COMPREHENSION_GUARD_AGENT: "antigravity" },
    );
    assert.deepEqual(JSON.parse(antigravity.stdout), { decision: "deny", reason: "wait" });
    assert.equal(antigravity.stdout.includes("CodeContent"), false);
  } finally {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("Cursor preToolUse Read prints a permission allow decision", async () => {
  const home = tempHome();
  try {
    const result = await runPause(
      {
        hook_event_name: "preToolUse",
        tool_name: "Read",
        tool_input: { file_path: "/tmp/a.ts" },
      },
      home,
    );
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), { permission: "allow" });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
