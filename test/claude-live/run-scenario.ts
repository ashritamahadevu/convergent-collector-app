/**
 * Runs ONE real Claude Code headless session against a throwaway project whose
 * .claude/settings.json holds exactly the hooks planHookInstall() would write
 * (plus a capture hook), and records what Claude sent.
 *
 * usage: npx tsx test/claude-live/run-scenario.ts <scenario> <outRoot>
 *
 * It never touches ~/.claude or ~/.comprehension-guard: COMPREHENSION_GUARD_HOME
 * points at <outRoot>/<scenario>/home and Claude is started with
 * --setting-sources project so user settings and user hooks are not loaded.
 */
import { spawn, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { planHookInstall } from "../../src/agentProtocol";

type Scenario = {
  prompt: string;
  maxTurns: number;
  receiver: "normal" | "none" | "blackhole";
  seed: Record<string, string>;
  projectDir?: string;
  homeDir?: string;
  extraArgs?: string[];
};

const LONG_TODO = "// TODO: add helpers\n";

const NOTEBOOK = JSON.stringify(
  {
    cells: [
      { cell_type: "markdown", id: "intro", metadata: {}, source: ["# Analysis\n"] },
      {
        cell_type: "code",
        execution_count: null,
        id: "calc",
        metadata: {},
        outputs: [],
        source: ["x = 1\n", "print(x)\n"],
      },
    ],
    metadata: { language_info: { name: "python" } },
    nbformat: 4,
    nbformat_minor: 5,
  },
  null,
  1,
) + "\n";

export const SCENARIOS: Record<string, Scenario> = {
  "edit-twice": {
    prompt:
      "You are in a test project. Do exactly this and nothing else. Do not use Bash. " +
      "Step 1: Read app.js. Step 2: use the Edit tool once to change the string 'hi' to 'hello' (small edit). " +
      "Step 3: use the Edit tool a second time on app.js to replace the line '// TODO: add helpers' with " +
      "a block of 10 to 14 lines of JavaScript defining functions clamp(x, min, max), sum(arr) and average(arr), each with a one-line comment. Then stop.",
    maxTurns: 6,
    receiver: "normal",
    seed: { "app.js": "function greet() {\n  return 'hi';\n}\n" + LONG_TODO + "module.exports = { greet };\n" },
  },
  "write-new-overwrite": {
    prompt:
      "You are in a test project. Do exactly this and nothing else. Do not use Bash. " +
      "Step 1: use the Write tool to create the NEW file utils/strings.js with 12 to 16 lines of JavaScript defining capitalize, slugify and truncate, exported with module.exports. " +
      "Step 2: Read config.js, then use the Write tool (not Edit) to overwrite config.js with a new version that keeps the existing keys and adds a validateConfig(cfg) function of about 10 lines that throws on bad values. Then stop.",
    maxTurns: 6,
    receiver: "normal",
    seed: { "config.js": "module.exports = {\n  port: 3000,\n  host: 'localhost',\n};\n" },
  },
  multiedit: {
    prompt:
      "You are in a test project. Read lib.js. Then make BOTH of these changes in ONE call of the MultiEdit tool if you have it " +
      "(if you do not have a MultiEdit tool, use one Edit call per change): change 'const A = 1;' to 'const A = 100;', and replace '// body' with a 10 line implementation of a function parseCsvLine(line) that handles quoted fields. Do not use Bash. Then stop.",
    maxTurns: 5,
    receiver: "normal",
    seed: { "lib.js": "const A = 1;\nfunction parse() {\n  // body\n}\nmodule.exports = { A, parse };\n" },
  },
  notebook: {
    prompt:
      "You are in a test project. Read analysis.ipynb. Then use the NotebookEdit tool to replace the source of the code cell with id 'calc' with a 10 to 12 line Python function moving_average(values, window) plus a call to it. Do not use Bash, Write or Edit. Then stop.",
    maxTurns: 5,
    receiver: "normal",
    seed: { "analysis.ipynb": NOTEBOOK },
  },
  "bash-edits": {
    prompt:
      "You are in a test project. Use ONLY the Bash tool, never Edit or Write. Run these three commands one at a time: " +
      "1) sed -i 's/hi/hey/' app.js   2) a cat >> app.js <<'EOF' heredoc that appends a 10 line JavaScript function sumSquares(arr) with comments   " +
      "3) echo \"module.exports = { version: '1.0.0', name: 'demo', description: 'a demo package used for testing hooks', keywords: ['a', 'b', 'c'] };\" > meta.js . Then stop.",
    maxTurns: 6,
    receiver: "normal",
    seed: { "app.js": "function greet() {\n  return 'hi';\n}\n" },
    extraArgs: ["--allowedTools", "Bash(sed:*)", "Bash(cat:*)", "Bash(echo:*)"],
  },
  "relative-inbox": {
    prompt:
      "You are in a test project. Read src/rel.js. Then call the Edit tool with file_path set to the RELATIVE path 'src/rel.js' (do not expand it to an absolute path) " +
      "and replace '// fill me' with a 10 line function debounce(fn, ms) with comments. Do not use Bash. Then stop.",
    maxTurns: 5,
    receiver: "none",
    seed: { "src/rel.js": "// fill me\nmodule.exports = {};\n" },
  },
  spaces: {
    prompt:
      "You are in a test project. Do not use Bash. Step 1: Read 'my module.js'. Step 2: use Edit to replace '// impl' in 'my module.js' with a 10 line function retry(fn, times) with comments. " +
      "Step 3: use Write to create the new file 'sub dir/new file.js' with 10 lines defining a function memoize(fn). Then stop.",
    maxTurns: 6,
    receiver: "normal",
    projectDir: "proj with spaces",
    homeDir: "guard home (x86)",
    seed: { "my module.js": "// impl\nmodule.exports = {};\n" },
  },
  "parallel-writes": {
    prompt:
      "You are in a test project. Do not use Bash and do not read anything. In ONE single response, issue EIGHT parallel Write tool calls that create " +
      "mod1.js, mod2.js, mod3.js, mod4.js, mod5.js, mod6.js, mod7.js and mod8.js. Each file must have 25 to 30 lines of distinct JavaScript (a small utility with comments). Then stop.",
    maxTurns: 3,
    receiver: "normal",
    seed: {},
  },
  blackhole: {
    prompt:
      "You are in a test project. Read app.js. Then use the Edit tool to replace '// TODO: add helpers' with a 10 line function range(start, end, step) with comments. Do not use Bash. Then stop.",
    maxTurns: 4,
    receiver: "blackhole",
    seed: { "app.js": "function greet() {\n  return 'hi';\n}\n" + LONG_TODO },
  },
};

function nodeBinary(): string {
  try {
    const out = execFileSync("where.exe", ["node"], { encoding: "utf8" });
    return out.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "node";
  } catch {
    return "node";
  }
}

/** The npm shim is a .cmd; spawn the real exe so the prompt is not re-parsed by cmd.exe. */
function claudeBinary(): string {
  if (process.env.CLAUDE_BIN) {
    return process.env.CLAUDE_BIN;
  }
  if (process.platform === "win32" && process.env.APPDATA) {
    const exe = path.join(process.env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if (fs.existsSync(exe)) {
      return exe;
    }
  }
  return "claude";
}

async function main(): Promise<void> {
  const name = process.argv[2];
  const outRoot = path.resolve(process.argv[3] ?? ".");
  const scenario = SCENARIOS[name];
  if (!scenario) {
    throw new Error("unknown scenario " + name + "; known: " + Object.keys(SCENARIOS).join(", "));
  }
  const root = path.join(outRoot, name);
  fs.rmSync(root, { recursive: true, force: true });
  const project = path.join(root, scenario.projectDir ?? "project");
  const home = path.join(root, scenario.homeDir ?? "home");
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  for (const [rel, text] of Object.entries(scenario.seed)) {
    const abs = path.join(project, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }

  const repo = path.resolve(__dirname, "..", "..");
  const nodePath = nodeBinary();
  const plan = planHookInstall({
    homeDir: home,
    nodePath,
    scriptSource: fs.readFileSync(path.join(repo, "hook", "notify.js"), "utf8"),
    claude: { kind: "missing" },
    codex: { kind: "missing" },
    cursor: { kind: "missing" },
  });
  // The notifier copy, exactly as the install command writes it.
  fs.mkdirSync(path.dirname(plan.scriptPath), { recursive: true });
  fs.writeFileSync(plan.scriptPath, plan.writes[0].contents);
  const claudeWrite = plan.writes.find((w) => w.path.endsWith(path.join(".claude", "settings.json")));
  if (!claudeWrite) {
    throw new Error("planHookInstall produced no Claude settings");
  }
  const settings = JSON.parse(claudeWrite.contents) as { hooks: Record<string, unknown[]>; env?: Record<string, string> };
  fs.writeFileSync(path.join(root, "planned-claude-settings.json"), claudeWrite.contents);
  // Capture hook: every tool, both events, so Bash edits are visible too.
  const capture = `"${nodePath}" "${path.join(repo, "test", "claude-live", "capture.js")}"`;
  for (const ev of ["PreToolUse", "PostToolUse"]) {
    settings.hooks[ev].push({ matcher: "*", hooks: [{ type: "command", command: capture, timeout: 10 }] });
  }
  settings.env = { COMPREHENSION_GUARD_HOME: home, CG_CAPTURE_LOG: path.join(root, "capture.jsonl") };
  fs.mkdirSync(path.join(project, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(project, ".claude", "settings.json"), JSON.stringify(settings, null, 2) + "\n");

  let receiver: ReturnType<typeof spawn> | undefined;
  if (scenario.receiver !== "none") {
    receiver = spawn(process.execPath, [path.join(__dirname, "receiver.js"), home, scenario.receiver], {
      stdio: ["pipe", "pipe", "inherit"],
    });
    await new Promise<void>((resolve, reject) => {
      receiver!.stdout!.on("data", (d: Buffer) => {
        if (d.toString().includes("READY")) {
          resolve();
        }
      });
      receiver!.on("exit", () => reject(new Error("receiver exited")));
    });
  }

  const args = [
    "-p",
    scenario.prompt,
    "--model",
    "haiku",
    "--max-turns",
    String(scenario.maxTurns),
    "--permission-mode",
    "acceptEdits",
    "--setting-sources",
    "project",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-hook-events",
    ...(scenario.extraArgs ?? []),
  ];
  const started = Date.now();
  const child = spawn(claudeBinary(), args, {
    cwd: project,
    env: { ...process.env, COMPREHENSION_GUARD_HOME: home, CG_CAPTURE_LOG: path.join(root, "capture.jsonl") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = fs.createWriteStream(path.join(root, "stream.jsonl"));
  child.stdout!.pipe(out);
  let stderr = "";
  child.stderr!.on("data", (d: Buffer) => (stderr += d.toString()));
  const code: number = await new Promise((resolve) => child.on("exit", (c) => resolve(c ?? -1)));
  const ended = Date.now();
  // Async PostToolUse hooks may still be running.
  await new Promise((r) => setTimeout(r, 4000));
  if (receiver) {
    receiver.stdin!.end();
    await new Promise((r) => setTimeout(r, 300));
  }

  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== ".claude") {
          walk(abs);
        }
      } else {
        files[path.relative(project, abs)] = fs.readFileSync(abs, "utf8");
      }
    }
  };
  walk(project);
  const inboxDir = path.join(home, ".comprehension-guard", "inbox");
  const inbox = fs.existsSync(inboxDir)
    ? fs.readdirSync(inboxDir).map((n) => ({ name: n, body: JSON.parse(fs.readFileSync(path.join(inboxDir, n), "utf8")) }))
    : [];
  const readJsonl = (p: string): unknown[] =>
    fs.existsSync(p) ? fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const result = {
    scenario: name,
    claudeVersion: execFileSync(claudeBinary(), ["--version"], { encoding: "utf8" }).trim(),
    exitCode: code,
    durationMs: ended - started,
    started,
    ended,
    project,
    home,
    stderr: stderr.slice(0, 4000),
    captures: readJsonl(path.join(root, "capture.jsonl")),
    received: readJsonl(path.join(home, "received.jsonl")),
    inbox,
    files,
  };
  fs.writeFileSync(path.join(root, "result.json"), JSON.stringify(result, null, 2));
  const summary = {
    scenario: name,
    exitCode: code,
    durationMs: result.durationMs,
    captures: (result.captures as { payload?: { hook_event_name?: string; tool_name?: string } }[]).map(
      (c) => (c.payload?.hook_event_name ?? "?") + ":" + (c.payload?.tool_name ?? "?"),
    ),
    received: result.received.length,
    inbox: inbox.length,
    files: Object.keys(files),
  };
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
