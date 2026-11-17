import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { AgentEdit } from "../../src/agentProtocol";
import { planForEdits } from "../../src/heldReview";
import { analyzeFile, analyzeFiles } from "../../src/sizing/analyze";

type Fixture = {
  file: string;
  language: string;
  unit: string;
  call: string;
  source: string;
};

const fixtures: Fixture[] = [
  {
    file: "score.js",
    language: "javascript",
    unit: "score",
    call: "helper",
    source: `function score(x) {\n  if (x > 0) return helper(x);\n  return 0;\n}\nfunction idle() {\n  return 1;\n}\n`,
  },
  {
    file: "score.ts",
    language: "typescript",
    unit: "score",
    call: "helper",
    source: `function score(x: number): number {\n  if (x > 0) return helper(x);\n  return 0;\n}\nfunction idle(): number {\n  return 1;\n}\n`,
  },
  {
    file: "score.tsx",
    language: "tsx",
    unit: "score",
    call: "helper",
    source: `function score(x: number): number {\n  if (x > 0) return helper(x);\n  return 0;\n}\nfunction idle(): number {\n  return 1;\n}\n`,
  },
  {
    file: "score.py",
    language: "python",
    unit: "score",
    call: "helper",
    source: `def score(x):\n    if x > 0:\n        return helper(x)\n    return 0\n\ndef idle():\n    return 1\n`,
  },
  {
    file: "score.c",
    language: "c",
    unit: "score",
    call: "helper",
    source: `int score(int x) {\n  if (x > 0) return helper(x);\n  return 0;\n}\nint idle(void) {\n  return 1;\n}\n`,
  },
  {
    file: "score.cpp",
    language: "cpp",
    unit: "score",
    call: "helper",
    source: `int score(int x) {\n  if (x > 0) return helper(x);\n  return 0;\n}\nint idle() {\n  return 1;\n}\n`,
  },
  {
    file: "score.go",
    language: "go",
    unit: "score",
    call: "helper",
    source: `func score(x int) int {\n  if x > 0 {\n    return helper(x)\n  }\n  return 0\n}\nfunc idle() int {\n  return 1\n}\n`,
  },
  {
    file: "score.rs",
    language: "rust",
    unit: "score",
    call: "helper",
    source: `fn score(x: i32) -> i32 {\n  if x > 0 {\n    return helper(x);\n  }\n  0\n}\nfn idle() -> i32 {\n  1\n}\n`,
  },
  {
    file: "Score.java",
    language: "java",
    unit: "score",
    call: "helper",
    source: `class Box {\n  int score(int x) {\n    if (x > 0) { return helper(x); }\n    return 0;\n  }\n  int idle() { return 1; }\n}\n`,
  },
  {
    file: "Score.cs",
    language: "csharp",
    unit: "Score",
    call: "Helper",
    source: `class Box {\n  int Score(int x) {\n    if (x > 0) { return Helper(x); }\n    return 0;\n  }\n  int Idle() { return 1; }\n}\n`,
  },
  {
    file: "score.rb",
    language: "ruby",
    unit: "score",
    call: "helper",
    source: `def score(x)\n  if x > 0\n    helper(x)\n  else\n    0\n  end\nend\ndef idle\n  1\nend\n`,
  },
  {
    file: "score.php",
    language: "php",
    unit: "score",
    call: "helper",
    source: `<?php\nfunction score($x) {\n  if ($x > 0) {\n    return helper($x);\n  }\n  return 0;\n}\nfunction idle() {\n  return 1;\n}\n`,
  },
  {
    file: "Score.kt",
    language: "kotlin",
    unit: "score",
    call: "helper",
    source: `fun score(x: Int): Int {\n  if (x > 0) {\n    return helper(x)\n  }\n  return 0\n}\nfun idle(): Int {\n  return 1\n}\n`,
  },
  {
    file: "Score.swift",
    language: "swift",
    unit: "score",
    call: "helper",
    source: `func score(x: Int) -> Int {\n  if x > 0 {\n    return helper(x)\n  }\n  return 0\n}\nfunc idle() -> Int {\n  return 1\n}\n`,
  },
  {
    file: "score.lua",
    language: "lua",
    unit: "score",
    call: "helper",
    source: `function score(x)\n  if x then\n    return helper(x)\n  end\nend\nfunction idle()\n  return 1\nend\n`,
  },
  {
    file: "score.sh",
    language: "bash",
    unit: "score",
    call: "helper",
    source: `score() {\n  if [ "$1" -gt 0 ]; then\n    helper "$1"\n  else\n    echo 0\n  fi\n}\nidle() {\n  echo 1\n}\n`,
  },
];

function asEdit(file: string, source: string): AgentEdit {
  return {
    agent: "claude-code",
    filePath: "/ws/" + file,
    snippet: source,
    hunks: [{ newText: source }],
    created: true,
    next: source,
    restore: { previous: "", next: source },
  };
}

const only = process.env.SIZING_LANG;
const self = fileURLToPath(import.meta.url);

function loaderArgs(): string[] {
  return process.execArgv.filter((arg) => arg.startsWith("--require") || arg.startsWith("--import"));
}

function runChild(language: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...loaderArgs(), self], {
      env: { ...process.env, SIZING_LANG: language },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      child.unref();
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error(`timed out\n${output}`)), 20000);
    const take = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("SIZING_DONE 0")) finish();
      else if (output.includes("SIZING_DONE 1")) finish(new Error(output.trim()));
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => {
      if (!output.includes("SIZING_DONE")) {
        finish(new Error(output.trim() || `language process exited ${code ?? "null"}`));
      }
    });
  });
}

function runIsolated(language: string, title: string, body: () => Promise<void>): void {
  if (only === language) {
    body().then(
      () => console.log("SIZING_DONE 0"),
      (error: unknown) => {
        console.error(error);
        console.log("SIZING_DONE 1");
      },
    );
    return;
  }
  if (only) return;
  test(title, () => runChild(language));
}

for (const fixture of fixtures) {
  runIsolated(fixture.language, fixture.language + " names the branched function and skips the trivial sibling", async () => {
    const result = await analyzeFile(fixture.file, fixture.source);
    assert.equal(result.language, fixture.language, result.units.map((unit) => unit.unit + ":" + unit.kind).join(","));
    const scored = result.units.find((unit) => unit.unit === fixture.unit);
    assert.ok(scored, "units: " + result.units.map((unit) => unit.unit).join(","));
    assert.ok(scored.kind === "function" || scored.kind === "method");
    assert.ok(scored.branches >= 1, "branches " + scored.branches);
    assert.ok(scored.calls.includes(fixture.call), "calls " + scored.calls.join(","));

    const planned = await planForEdits([asEdit(fixture.file, fixture.source)], { preset: "standard" });
    const asked = planned.chunks.map((chunk) => chunk.unit);
    assert.ok(asked.includes(fixture.unit), "asked " + asked.join(","));
    assert.equal(asked.includes("idle") || asked.includes("Idle"), false);
  });
}

runIsolated("links", "a three-file javascript change links the caller and does not quiz the untouched helper", async () => {
  const callee = `function callee(x) {\n  if (x) return x;\n  return 0;\n}\n`;
  const helper = `function helper(x) {\n  if (x) return x;\n  return 0;\n}\n`;
  const caller = `function caller(x) {\n  if (x) return callee(x);\n  return 0;\n}\n`;
  const [calleeFile, helperFile, callerFile] = await analyzeFiles([
    { file: "callee.js", source: callee },
    { file: "helper.js", source: helper },
    { file: "caller.js", source: caller },
  ]);
  const calleeUnit = calleeFile.units.find((unit) => unit.unit === "callee");
  const callerUnit = callerFile.units.find((unit) => unit.unit === "caller");
  const helperUnit = helperFile.units.find((unit) => unit.unit === "helper");
  assert.ok(calleeUnit);
  assert.ok(callerUnit);
  assert.ok(helperUnit);
  assert.ok(calleeUnit.callers.includes("caller"));
  assert.deepEqual(callerUnit.calls, ["callee"]);
  assert.equal(helperUnit.callers.includes("caller"), false);

  const planned = await planForEdits([asEdit("caller.js", caller)], { preset: "standard" });
  const asked = planned.chunks.map((chunk) => chunk.unit);
  assert.ok(asked.includes("caller"));
  assert.equal(asked.includes("helper"), false);
  assert.equal(asked.includes("callee"), false);
});
