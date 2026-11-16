import "./installVscodeStub";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import * as vscodeStub from "./vscodeStub";
import { FREE_TEXT_QUESTION, SNIPPET, fakeContext, judgeJson } from "./harness";
import { runCliPrompt } from "../../src/cliRunner";
import { clearQuestionCache, generateQuestion, judge, setLogSink } from "../../src/llm";
import type { GeneratedQuestion } from "../../src/types";

/**
 * *-cli providers with a FAKE `claude` / `agent` on a private PATH.
 * PATH is reduced to the fake dir + Windows system dirs, so the real CLIs
 * installed on this machine can never be launched by these tests.
 */

let dir: string;
const savedPath = process.env.PATH;
const logs: string[] = [];

const FAKE_JS = `
const fs = require("fs");
const mode = process.env.CG_FAKE_MODE || "garbage";
const out = process.env.CG_FAKE_OUT;
if (process.env.CG_FAKE_PIDFILE) fs.writeFileSync(process.env.CG_FAKE_PIDFILE, String(process.pid));
let input = "";
process.stdin.on("data", (c) => (input += c));
let done = false;
const finish = () => {
  if (done) return;
  done = true;
  if (process.env.CG_FAKE_STDIN) fs.writeFileSync(process.env.CG_FAKE_STDIN, input);
  if (mode === "garbage") { process.stdout.write("Sure! Here is my answer: it looks fine to me."); process.exit(0); }
  if (mode === "json") { process.stdout.write(out); process.exit(0); }
  if (mode === "slowjson") { setTimeout(() => { process.stdout.write(out); process.exit(0); }, 1000); return; }
  if (mode === "exit3") { process.stderr.write("internal error: upstream 503"); process.exit(3); }
  if (mode === "login") { process.stderr.write("Not logged in. Please run /login"); process.exit(1); }
  if (mode === "empty") { process.exit(0); }
  if (mode === "hang") { setInterval(() => {}, 1000); return; }
};
// stdin may never close for argument-delivery CLIs; do not wait on it forever.
process.stdin.on("end", finish);
setTimeout(finish, 300);
`;

function setMode(mode: string, out?: unknown): void {
  process.env.CG_FAKE_MODE = mode;
  process.env.CG_FAKE_OUT = out === undefined ? "" : typeof out === "string" ? out : JSON.stringify(out);
}

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "cg-fake-cli-"));
  writeFileSync(path.join(dir, "fake.js"), FAKE_JS);
  for (const name of ["claude", "agent"]) {
    writeFileSync(path.join(dir, name + ".cmd"), `@"${process.execPath}" "%~dp0fake.js" %*\r\n`);
  }
  setLogSink((l) => logs.push(l));
});

after(() => {
  process.env.PATH = savedPath;
  rmSync(dir, { recursive: true, force: true });
});

const sysRoot = process.env.SystemRoot ?? "C:\\Windows";
const SYSTEM_PATH = [path.join(sysRoot, "System32"), path.join(sysRoot, "System32", "WindowsPowerShell", "v1.0"), sysRoot].join(";");

beforeEach(() => {
  clearQuestionCache();
  vscodeStub.resetStub();
  process.env.PATH = dir + ";" + SYSTEM_PATH;
  delete process.env.CG_FAKE_PIDFILE;
  delete process.env.CG_FAKE_STDIN;
  logs.length = 0;
});

async function timed<T>(fn: () => Promise<T>) {
  const start = Date.now();
  try {
    return { ms: Date.now() - start, value: await fn(), error: undefined as Error | undefined, end: Date.now() - start };
  } catch (err) {
    return { ms: Date.now() - start, value: undefined, error: err as Error };
  }
}

describe("runCliPrompt with a fake CLI", { skip: process.platform !== "win32" && "Windows PowerShell path only" }, () => {
  test("BUG (low): CLI missing from PATH -> rejects, but as 'returned an empty response', not 'not installed'", async () => {
    process.env.PATH = SYSTEM_PATH;
    const r = await timed(() => runCliPrompt("claude-cli", "hello", "", 20_000));
    assert.ok(r.error, "should reject");
    console.log("[observed] missing CLI -> " + r.error!.message);
    assert.match(r.error!.message, /not installed/);
  });

  test("CLI prints garbage with exit 0 -> resolves with the garbage text", async () => {
    setMode("garbage");
    const r = await timed(() => runCliPrompt("claude-cli", "hello", "", 20_000));
    assert.ifError(r.error);
    assert.match(r.value!.text, /Sure! Here is my answer/);
  });

  test("CLI exits non-zero -> rejects with its stderr", async () => {
    setMode("exit3");
    const r = await timed(() => runCliPrompt("claude-cli", "hello", "", 20_000));
    assert.ok(r.error);
    assert.match(r.error!.message, /upstream 503/);
  });

  test("CLI not signed in -> 'not signed in' message", async () => {
    setMode("login");
    const r = await timed(() => runCliPrompt("cursor-cli", "hello", "", 20_000));
    assert.ok(r.error);
    assert.match(r.error!.message, /not signed in/);
  });

  test("CLI prints nothing -> 'returned an empty response'", async () => {
    setMode("empty");
    const r = await timed(() => runCliPrompt("claude-cli", "hello", "", 20_000));
    assert.ok(r.error);
    assert.match(r.error!.message, /empty response/);
  });

  test("CLI hangs past timeoutMs -> rejects at the timeout and the process tree is killed", async () => {
    setMode("hang");
    const pidFile = path.join(dir, "pid.txt");
    process.env.CG_FAKE_PIDFILE = pidFile;
    const r = await timed(() => runCliPrompt("claude-cli", "hello", "", 4000));
    assert.ok(r.error);
    assert.match(r.error!.message, /timed out after 4000ms/);
    assert.ok(r.ms >= 3900 && r.ms < 8000, "took " + r.ms);
    await new Promise((res) => setTimeout(res, 1500));
    assert.ok(existsSync(pidFile), "fake CLI started");
    const pid = Number(readFileSync(pidFile, "utf8"));
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    assert.equal(alive, false, "fake CLI pid " + pid + " should be dead after taskkill /T");
  });

  test("slow but under the timeout -> succeeds", async () => {
    setMode("slowjson", { ok: true });
    const r = await timed(() => runCliPrompt("claude-cli", "hello", "", 20_000));
    assert.ifError(r.error);
    assert.equal(r.value!.text, '{"ok":true}');
  });

  test("prompt reaches a stdin-delivery CLI intact (ASCII)", async () => {
    setMode("garbage");
    const stdinFile = path.join(dir, "stdin.txt");
    process.env.CG_FAKE_STDIN = stdinFile;
    const prompt = "line one\nline \"two\" with 'quotes' and $dollar";
    await runCliPrompt("claude-cli", prompt, "", 20_000);
    assert.equal(readFileSync(stdinFile, "utf8").trim().replace(/\r\n/g, "\n"), prompt);
  });
});

describe("cli providers through llm.ts", { skip: process.platform !== "win32" && "Windows PowerShell path only" }, () => {
  test("garbage CLI output: generation rejects (caller falls back); judge -> no_decision (caller passes)", async () => {
    vscodeStub.settings.set("comprehensionGuard.provider", "claude-cli");
    setMode("garbage");
    const ctx = fakeContext();
    const g = await timed(() => generateQuestion({ context: ctx as never, snippet: SNIPPET, language: "js", mode: "free-text" }));
    assert.ok(g.error);
    assert.match(g.error!.message, /parse/i);
    const j = await judge({
      context: ctx as never,
      snippet: SNIPPET,
      language: "js",
      question: FREE_TEXT_QUESTION as GeneratedQuestion,
      studentAnswer: "banana banana banana",
    });
    assert.deepEqual(j, { kind: "no_decision", reason: "parse_failed" });
  });

  test("valid CLI output works end to end", async () => {
    vscodeStub.settings.set("comprehensionGuard.provider", "claude-cli");
    setMode("json", judgeJson(["fail", "fail"]));
    const j = await judge({
      context: fakeContext() as never,
      snippet: SNIPPET,
      language: "js",
      question: FREE_TEXT_QUESTION as GeneratedQuestion,
      studentAnswer: "banana banana banana",
    });
    assert.equal(j.kind, "decided");
  });

  test("missing CLI: generation rejects quickly (caller falls back)", async () => {
    vscodeStub.settings.set("comprehensionGuard.provider", "claude-cli");
    process.env.PATH = SYSTEM_PATH;
    const g = await timed(() => generateQuestion({ context: fakeContext() as never, snippet: SNIPPET, language: "js", mode: "free-text" }));
    assert.ok(g.error);
    console.log("[observed] missing CLI via llm.ts -> " + g.ms + "ms: " + g.error!.message);
    assert.ok(logs.some((l) => /cli claude-cli .*outcome=error/.test(l)));
  });
});
