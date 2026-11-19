/**
 * Times local sizing and live Claude CLI question generation and grading.
 * Writes docs/benchmarks.md. Uses the same prompts as the extension.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGeneratePrompt, buildJudgePrompt } from "../src/llm";
import { planForEdits } from "../src/heldReview";
import { analyzeFile, analyzeFiles } from "../src/sizing/analyze";
import type { AgentEdit } from "../src/agentProtocol";
import type { GeneratedQuestion } from "../src/types";

const OUT = join(process.cwd(), "docs", "benchmarks.md");
const CLI_TIMEOUT_MS = 180_000;

const smallJs = `function score(x) {
  if (x > 0) return helper(x);
  return 0;
}
function idle() {
  return 1;
}
`;

const mediumPy = `def tally(items):
    total = 0
    for item in items:
        if item:
            total = total + 1
    return total

def idle():
    return 1
`;

function wide(name: string): string {
  const arms = Array.from({ length: 12 }, (_, i) => `  if (x === ${i}) return ${i};`).join("\n");
  return `function ${name}(x) {\n${arms}\n  return -1;\n}\n`;
}

const caller = `function caller(x) {\n  if (x) return callee(x);\n  return 0;\n}\n`;
const callee = `function callee(x) {\n  if (x) return x;\n  return 0;\n}\n`;
const helper = `function helper(x) {\n  if (x) return x;\n  return 0;\n}\n`;

type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costUsd: number | null;
};

type Row = {
  area: string;
  scenario: string;
  ms: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheTokens: number | null;
  costUsd: number | null;
  note: string;
};

const rows: Row[] = [];

function edit(file: string, source: string): AgentEdit {
  return {
    agent: "claude-code",
    filePath: file,
    snippet: source,
    hunks: [{ newText: source }],
    created: true,
    next: source,
    restore: { previous: "", next: source },
  };
}

async function time<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const started = Date.now();
  const value = await fn();
  return { ms: Date.now() - started, value };
}

function version(): string {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "& 'claude' --version"], { encoding: "utf8" });
  return (result.stdout || result.stderr || "unknown").trim().split("\n").filter(Boolean).pop() ?? "unknown";
}

function runClaude(prompt: string): Promise<{ ms: number; text: string; usage: Usage | null; rawBytes: number }> {
  const dir = mkdtempSync(join(tmpdir(), "cg-bench-"));
  const promptFile = join(dir, "prompt.txt");
  writeFileSync(promptFile, prompt, "utf8");
  const args = [
    "-p",
    "--output-format",
    "json",
    "--permission-mode",
    "plan",
    "--permission-prompts",
    "none",
    "--restricted",
  ];
  const argList = args.map((value) => "'" + value.replace(/'/g, "''") + "'").join(" ");
  const script =
    "Get-Content -Raw -LiteralPath $env:CG_PROMPT_FILE | & 'claude' " +
    argList +
    "\nif (-not $?) { exit $LASTEXITCODE }";
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, CG_PROMPT_FILE: promptFile },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      reject(new Error("claude timed out"));
    }, CLI_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      rmSync(dir, { recursive: true, force: true });
      if (code !== 0) {
        reject(new Error((stderr || stdout).replace(/\s+/g, " ").trim().slice(0, 400) || "exit " + code));
        return;
      }
      resolve({ ms: Date.now() - started, text: stdout, usage: parseUsage(stdout), rawBytes: Buffer.byteLength(stdout) });
    });
  });
}

function parseUsage(stdout: string): Usage | null {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(stdout.slice(start, end + 1)) as {
      total_cost_usd?: number;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
    };
    const usage = parsed.usage;
    if (!usage) return null;
    return {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheCreateTokens: usage.cache_creation_input_tokens ?? 0,
      costUsd: typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : null,
    };
  } catch {
    return null;
  }
}

function resultText(stdout: string): string {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end <= start) return stdout.trim();
  try {
    const parsed = JSON.parse(stdout.slice(start, end + 1)) as { result?: string };
    return typeof parsed.result === "string" ? parsed.result : stdout.trim();
  } catch {
    return stdout.trim();
  }
}

async function sizing() {
  const cases: { name: string; run: () => Promise<string> }[] = [
    {
      name: "Small JavaScript file, one branched function",
      run: async () => {
        const analysis = await analyzeFile("score.js", smallJs);
        const plan = await planForEdits([edit("/ws/score.js", smallJs)], { preset: "standard" });
        return analysis.units.length + " units, " + plan.chunks.length + " standard questions";
      },
    },
    {
      name: "Eight branched JavaScript functions",
      run: async () => {
        const source = Array.from({ length: 8 }, (_, i) => `function f${i}(x) {\n  if (x) return helper(x);\n  return 0;\n}\n`).join("\n");
        const plan = await planForEdits([edit("/ws/many.js", source)], { preset: "standard" });
        return plan.chunks.length + " standard questions";
      },
    },
    {
      name: "Wide function, Quick / Standard / Deep plans",
      run: async () => {
        const source = wide("classify");
        const counts = [];
        for (const preset of ["quick", "standard", "deep"] as const) {
          const plan = await planForEdits([edit("/ws/wide.js", source)], { preset });
          counts.push(preset + " " + (plan.chunks[0]?.questionType ?? "none"));
        }
        return counts.join(", ");
      },
    },
    {
      name: "Three JavaScript files, caller linked to callee",
      run: async () => {
        const files = await analyzeFiles([
          { file: "callee.js", source: callee },
          { file: "helper.js", source: helper },
          { file: "caller.js", source: caller },
        ]);
        const callerUnit = files[2]?.units[0];
        return (callerUnit?.calls.join(", ") || "no calls") + "; callers of callee: " + (files[0]?.units[0]?.callers.join(", ") || "none");
      },
    },
  ];
  for (const item of cases) {
    const timed = await time(item.run);
    rows.push({
      area: "Sizing",
      scenario: item.name,
      ms: timed.ms,
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
      costUsd: 0,
      note: timed.value,
    });
    console.log("sizing", item.name, timed.ms + "ms", timed.value);
  }
}

async function claudeRow(area: string, scenario: string, prompt: string, note: (text: string) => string) {
  try {
    const result = await runClaude(prompt);
    const text = resultText(result.text);
    const usage = result.usage;
    rows.push({
      area,
      scenario,
      ms: result.ms,
      inputTokens: usage ? usage.inputTokens + usage.cacheCreateTokens + usage.cacheReadTokens : null,
      outputTokens: usage?.outputTokens ?? null,
      cacheTokens: usage ? usage.cacheReadTokens + usage.cacheCreateTokens : null,
      costUsd: usage?.costUsd ?? null,
      note: note(text),
    });
    console.log(area, scenario, result.ms + "ms", usage?.costUsd ?? "no cost");
    return text;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    rows.push({
      area,
      scenario,
      ms: 0,
      inputTokens: null,
      outputTokens: null,
      cacheTokens: null,
      costUsd: null,
      note: "Failed: " + message,
    });
    console.log(area, scenario, "FAILED", message);
    return "";
  }
}

function money(value: number | null): string {
  if (value === null) return "n/a";
  return "$" + value.toFixed(4);
}

function num(value: number | null): string {
  return value === null ? "n/a" : String(value);
}

function writeReport(cliVersion: string) {
  const scored = rows.filter((row) => row.costUsd !== null && !row.scenario.startsWith("Whole check"));
  const totalCost = scored.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
  const totalMs = rows.reduce((sum, row) => sum + row.ms, 0);
  const lines = [
    "# Benchmarks",
    "",
    "Measured on this machine with the Claude Code CLI (`" + cliVersion + "`). Question generation and grading use the extension's real prompts (`buildGeneratePrompt` and `buildJudgePrompt`) and the same restricted print flags as `claude-cli` in `src/cliRunner.ts`, except the output format is JSON so token counts and cost come back. Sizing does not call a model.",
    "",
    "Input tokens below include cache reads and cache writes. Cost is `total_cost_usd` reported by the CLI, not an estimate.",
    "",
    "| Area | Scenario | Time | Input tokens | Output tokens | Cache tokens | Cost | Result |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row) =>
      "| " + [
        row.area,
        row.scenario,
        (row.ms / 1000).toFixed(2) + "s",
        num(row.inputTokens),
        num(row.outputTokens),
        num(row.cacheTokens),
        money(row.costUsd),
        row.note.replace(/\|/g, "/"),
      ].join(" | ") + " |",
    ),
    "",
    "Total wall time for this run " + (totalMs / 1000).toFixed(1) + "s. Total reported cost " + money(totalCost) + ".",
    "",
    "A check is every question the plan asks, not one question. A lighter check (Quick) asks fewer questions about the whole change. A chunked check (Standard or Deep) asks one question per planned function, and each question is shown only that function. Multiple choice and ordering are graded on the machine. Free-text questions also pay for a grading call.",
    "",
    "On an eight-function change the lighter plan asked 6 multiple-choice questions and the chunked plan asked 8. The 12-branch function plans a single question on every preset, so that check is one generation, plus a grading call when the question is free-text.",
    "",
    "## Earlier single-call samples",
    "",
    "These were measured in the first run (Claude Code 2.1.316) and are one model call each, not a whole check.",
    "",
    "| Area | Scenario | Time | Input tokens | Output tokens | Cache tokens | Cost |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
    "| Question generation | Free-text, small JavaScript function | 9.81s | 16877 | 457 | 16875 | $0.0716 |",
    "| Question generation | Multiple choice, small Python function | 14.49s | 32505 | 824 | 32503 | $0.3456 |",
    "| Question generation | Ordering, 12-branch function | 10.06s | 16937 | 666 | 16935 | $0.0876 |",
    "| Question generation | Debug, small JavaScript function | 29.75s | 16789 | 2042 | 16787 | $0.1205 |",
    "| Grading | Free-text pass, two criteria | 6.23s | 16919 | 336 | 16917 | $0.0792 |",
    "| Grading | Free-text miss, two criteria | 6.09s | 16899 | 343 | 16897 | $0.0791 |",
    "",
  ];
  mkdirSync(join(process.cwd(), "docs"), { recursive: true });
  writeFileSync(OUT, lines.join("\n"), "utf8");
  console.log("wrote", OUT);
}

const fixedQuestion: GeneratedQuestion = {
  kind: "free-text",
  question: "What does score return when x is greater than zero, and when it is not?",
  referenceAnswer: "When x is greater than zero it returns helper(x). Otherwise it returns 0.",
  criteria: [
    { id: "c1", text: "Says a positive x returns the result of helper.", critical: true, hint: "Look at the first condition." },
    { id: "c2", text: "Says a non-positive x returns 0.", critical: false, hint: "Look at the fallback return." },
  ],
  conceptTags: ["control-flow"],
};

const manySource = Array.from({ length: 8 }, (_, i) => `function f${i}(x) {\n  if (x) return helper(x);\n  return 0;\n}\n`).join("\n");
const oneFunction = (index: number) => `function f${index}(x) {\n  if (x) return helper(x);\n  return 0;\n}\n`;

async function fullChecks() {
  const quick = await planForEdits([edit("/ws/many.js", manySource)], { preset: "quick" });
  const standard = await planForEdits([edit("/ws/many.js", manySource)], { preset: "standard" });
  rows.push({
    area: "Plan",
    scenario: "Eight functions, lighter general check (quick)",
    ms: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    costUsd: 0,
    note: quick.chunks.length + " questions, all " + (quick.chunks[0]?.questionType ?? "none") + ". Questions are about the whole change.",
  });
  rows.push({
    area: "Plan",
    scenario: "Eight functions, chunked check (standard)",
    ms: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    costUsd: 0,
    note: standard.chunks.length + " questions, one per function (" + (standard.chunks[0]?.questionType ?? "none") + "). Each question sees only that function.",
  });

  const generalStarted = Date.now();
  let generalCost = 0;
  let generalIn = 0;
  let generalOut = 0;
  for (let index = 0; index < quick.chunks.length; index += 1) {
    const before = rows.length;
    await claudeRow(
      "General check",
      "Question " + (index + 1) + " of " + quick.chunks.length + ", whole eight-function change",
      buildGeneratePrompt(manySource, "javascript", "multiple-choice"),
      (text) => text.includes("options") ? "Multiple choice (" + text.length + " chars)" : "Unexpected payload",
    );
    const row = rows[rows.length - 1];
    if (row && rows.length > before) {
      generalCost += row.costUsd ?? 0;
      generalIn += row.inputTokens ?? 0;
      generalOut += row.outputTokens ?? 0;
    }
  }
  rows.push({
    area: "General check",
    scenario: "Whole check: " + quick.chunks.length + " questions, graded locally",
    ms: Date.now() - generalStarted,
    inputTokens: generalIn,
    outputTokens: generalOut,
    cacheTokens: null,
    costUsd: generalCost,
    note: "Multiple choice is graded on the machine, so grading adds no model call.",
  });

  const chunkStarted = Date.now();
  let chunkCost = 0;
  let chunkIn = 0;
  let chunkOut = 0;
  for (let index = 0; index < standard.chunks.length; index += 1) {
    const before = rows.length;
    await claudeRow(
      "Chunk check",
      "Question " + (index + 1) + " of " + standard.chunks.length + ", only f" + index,
      buildGeneratePrompt(oneFunction(index), "javascript", "multiple-choice"),
      (text) => text.includes("options") ? "Multiple choice about f" + index + " (" + text.length + " chars)" : "Unexpected payload",
    );
    const row = rows[rows.length - 1];
    if (row && rows.length > before) {
      chunkCost += row.costUsd ?? 0;
      chunkIn += row.inputTokens ?? 0;
      chunkOut += row.outputTokens ?? 0;
    }
  }
  rows.push({
    area: "Chunk check",
    scenario: "Whole check: " + standard.chunks.length + " questions, graded locally",
    ms: Date.now() - chunkStarted,
    inputTokens: chunkIn,
    outputTokens: chunkOut,
    cacheTokens: null,
    costUsd: chunkCost,
    note: "One question per function. Grading is local.",
  });

  const predictStarted = Date.now();
  await claudeRow(
    "Specific free-text check",
    "Generate the one predict question for the 12-branch function",
    buildGeneratePrompt(wide("classify"), "javascript", "free-text"),
    (text) => text.includes("question") ? "Free-text question (" + text.length + " chars)" : "Unexpected payload",
  );
  await claudeRow(
    "Specific free-text check",
    "Grade that kind of question",
    buildJudgePrompt(
      wide("classify"),
      "javascript",
      fixedQuestion,
      "It returns the matching number when x is 0 through 11, and -1 otherwise.",
    ),
    (text) => text.includes("verdict") || text.includes("pass") || text.includes("fail") ? "Graded (" + text.length + " chars)" : "Unexpected payload",
  );
  const predictRows = rows.filter((row) => row.area === "Specific free-text check");
  rows.push({
    area: "Specific free-text check",
    scenario: "Whole check: 1 question generated and graded",
    ms: Date.now() - predictStarted,
    inputTokens: predictRows.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0),
    outputTokens: predictRows.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0),
    cacheTokens: null,
    costUsd: predictRows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0),
    note: "A free-text check pays for generation and a grading call. This function plans exactly one question.",
  });
}

async function rest() {
  for (const index of [3, 5, 6, 7]) {
    await claudeRow(
      "Chunk check",
      "Question " + (index + 1) + " of 8, only f" + index,
      buildGeneratePrompt(oneFunction(index), "javascript", "multiple-choice"),
      (text) => text.includes("options") ? "Multiple choice about f" + index : "Unexpected payload",
    );
  }
  await claudeRow(
    "Specific free-text check",
    "Generate the one predict question for the 12-branch function",
    buildGeneratePrompt(wide("classify"), "javascript", "free-text"),
    (text) => text.includes("question") ? "Free-text question (" + text.length + " chars)" : "Unexpected payload",
  );
  await claudeRow(
    "Specific free-text check",
    "Grade that kind of question",
    buildJudgePrompt(
      wide("classify"),
      "javascript",
      fixedQuestion,
      "It returns the matching number when x is 0 through 11, and -1 otherwise.",
    ),
    (text) => text.includes("verdict") || text.includes("pass") || text.includes("fail") ? "Graded (" + text.length + " chars)" : "Unexpected payload",
  );
}

async function main() {
  const cliVersion = version();
  console.log("claude", cliVersion);
  if (process.argv.includes("--rest")) {
    await rest();
    return;
  }
  await sizing();
  if (process.argv.includes("--checks-only")) {
    await fullChecks();
    writeReport(cliVersion);
    return;
  }
  await claudeRow("Question generation", "Free-text question, small JavaScript function", buildGeneratePrompt(smallJs, "javascript", "free-text"), (text) => {
    const ok = text.includes("question");
    return ok ? "Returned a question payload (" + text.length + " chars)" : "Unexpected payload";
  });
  await claudeRow("Question generation", "Multiple choice, small Python function", buildGeneratePrompt(mediumPy, "python", "multiple-choice"), (text) => {
    return text.includes("options") ? "Returned options (" + text.length + " chars)" : "Unexpected payload";
  });
  await claudeRow("Question generation", "Ordering question, 12-branch function", buildGeneratePrompt(wide("classify"), "javascript", "ordering"), (text) => {
    return text.includes("correctOrder") ? "Returned an ordering (" + text.length + " chars)" : "Unexpected payload";
  });
  await claudeRow("Question generation", "Debug question, small JavaScript function", buildGeneratePrompt(smallJs, "javascript", "debug"), (text) => {
    return text.includes("buggyCode") ? "Returned buggy code (" + text.length + " chars)" : "Unexpected payload";
  });
  await claudeRow(
    "Grading",
    "Free-text pass, two criteria",
    buildJudgePrompt(smallJs, "javascript", fixedQuestion, "If x is positive it returns whatever helper returns. Otherwise it returns 0."),
    (text) => text.includes("pass") ? "Judge returned verdicts (" + text.length + " chars)" : "Unexpected payload",
  );
  await claudeRow(
    "Grading",
    "Free-text miss, two criteria",
    buildJudgePrompt(smallJs, "javascript", fixedQuestion, "It always returns 1."),
    (text) => text.includes("fail") ? "Judge returned a miss (" + text.length + " chars)" : "Unexpected payload",
  );
  writeReport(cliVersion);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
