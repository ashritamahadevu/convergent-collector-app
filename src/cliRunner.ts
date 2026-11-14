import { spawn } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Provider } from "./types";

export type CliProvider =
  | "claude-cli"
  | "cursor-cli"
  | "codex-cli"
  | "gemini-cli"
  | "copilot-cli";

export function isCliProvider(provider: Provider): provider is CliProvider {
  return (
    provider === "claude-cli" ||
    provider === "cursor-cli" ||
    provider === "codex-cli" ||
    provider === "gemini-cli" ||
    provider === "copilot-cli"
  );
}

type PromptDelivery = "argument" | "stdin";

type CliSpec = {
  command: string;
  /** Fixed args only. The student prompt is never placed in this list. */
  args: string[];
  delivery: PromptDelivery;
  modelFlag: string;
};

/**
 * Read-only invocations. None of these enable --force, --yolo, or a
 * workspace-write sandbox. Claude is given an empty tool list so it cannot
 * edit files or run commands.
 */
const CLI_SPECS: Record<CliProvider, CliSpec> = {
  "claude-cli": {
    command: "claude",
    args: [
      "-p",
      "--output-format",
      "text",
      "--permission-mode",
      "plan",
      "--permission-prompts",
      "none",
      "--restricted",
    ],
    delivery: "stdin",
    modelFlag: "--model",
  },
  "cursor-cli": {
    command: "agent",
    args: ["-p", "--output-format", "text", "--mode", "ask", "--trust"],
    delivery: "argument",
    modelFlag: "--model",
  },
  "codex-cli": {
    command: "codex",
    args: ["exec", "--sandbox", "read-only", "-"],
    delivery: "stdin",
    modelFlag: "--model",
  },
  "gemini-cli": {
    command: "gemini",
    args: [],
    delivery: "argument",
    modelFlag: "--model",
  },
  "copilot-cli": {
    command: "copilot",
    args: ["-p", "--output-format", "text", "--mode", "plan", "--no-ask-user"],
    delivery: "argument",
    modelFlag: "--model",
  },
};

const LOGIN_ERROR = /not logged in|failed to authenticate|please run \/login|sign in|authentication/i;

export async function runCliPrompt(
  provider: CliProvider,
  prompt: string,
  model: string,
  timeoutMs: number,
): Promise<{ text: string; command: string; ms: number }> {
  const spec = CLI_SPECS[provider];
  const started = Date.now();
  const dir = mkdtempSync(join(tmpdir(), "comprehension-guard-"));
  const promptFile = join(dir, "prompt.txt");
  writeFileSync(promptFile, prompt, "utf8");

  try {
    const text = await runSpec(spec, promptFile, model, timeoutMs);
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error(spec.command + " returned an empty response.");
    }
    return { text: trimmed, command: spec.command, ms: Date.now() - started };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(spec.command + " failed: " + message.slice(0, 300));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runSpec(
  spec: CliSpec,
  promptFile: string,
  model: string,
  timeoutMs: number,
): Promise<string> {
  const modelArgs = model.trim() ? [spec.modelFlag, model.trim()] : [];
  const commandArgs = [...spec.args, ...modelArgs];
  if (spec.command === "gemini" && spec.delivery === "argument") {
    commandArgs.unshift("-p");
  }

  if (process.platform === "win32") {
    return runInPowerShell(spec, commandArgs, promptFile, timeoutMs);
  }
  return runDirect(spec, commandArgs, promptFile, timeoutMs);
}

function runDirect(
  spec: CliSpec,
  commandArgs: string[],
  promptFile: string,
  timeoutMs: number,
): Promise<string> {
  const { readFileSync } = require("fs") as typeof import("fs");
  const prompt = readFileSync(promptFile, "utf8");
  const args = spec.delivery === "argument" ? insertPrompt(commandArgs, prompt) : commandArgs;
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    finishChild(child, spec, timeoutMs, resolve, reject);
    if (spec.delivery === "stdin") {
      child.stdin.write(prompt);
    }
    child.stdin.end();
  });
}

function runInPowerShell(
  spec: CliSpec,
  commandArgs: string[],
  promptFile: string,
  timeoutMs: number,
): Promise<string> {
  const argList = commandArgs.map(psQuote).join(" ");
  const invoke =
    spec.delivery === "stdin"
      ? "Get-Content -Raw -LiteralPath $env:CG_PROMPT_FILE | & " +
        psQuote(spec.command) +
        " " +
        argList
      : "$p = Get-Content -Raw -LiteralPath $env:CG_PROMPT_FILE; & " +
        psQuote(spec.command) +
        " " +
        insertPromptPowerShell(commandArgs);
  const script = invoke + "\nif (-not $?) { exit $LASTEXITCODE }";

  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, CG_PROMPT_FILE: promptFile },
      },
    );
    finishChild(child, spec, timeoutMs, resolve, reject);
  });
}

function finishChild(
  child: ReturnType<typeof spawn>,
  spec: CliSpec,
  timeoutMs: number,
  resolve: (text: string) => void,
  reject: (err: Error) => void,
): void {
  let stdout = "";
  let stderr = "";
  const timer = setTimeout(() => {
    killChild(child);
    reject(new Error(spec.command + " timed out after " + timeoutMs + "ms"));
  }, timeoutMs);

  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  child.on("error", (err) => {
    clearTimeout(timer);
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      reject(new Error(spec.command + " is not installed."));
      return;
    }
    reject(err);
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    const detail = (stderr || stdout).replace(/\s+/g, " ").trim().slice(0, 240);
    if (/not recognized|command not found|No such file|ENOENT/i.test(detail)) {
      reject(new Error(spec.command + " is not installed."));
      return;
    }
    if (code !== 0) {
      if (LOGIN_ERROR.test(detail)) {
        reject(new Error(spec.command + " is not signed in. " + detail));
        return;
      }
      reject(new Error(detail || spec.command + " exited with code " + code));
      return;
    }
    resolve(stdout);
  });
}

function killChild(child: ReturnType<typeof spawn>): void {
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  child.kill("SIGKILL");
}

function insertPrompt(args: string[], prompt: string): string[] {
  const flag = args.indexOf("-p");
  if (flag >= 0) {
    const next = args.slice();
    next.splice(flag + 1, 0, prompt);
    return next;
  }
  return [...args, prompt];
}

/** Puts $p immediately after -p so later flags cannot consume the prompt. */
function insertPromptPowerShell(args: string[]): string {
  const flag = args.indexOf("-p");
  if (flag < 0) {
    return args.map(psQuote).join(" ") + " $p";
  }
  const before = args.slice(0, flag + 1).map(psQuote).join(" ");
  const after = args.slice(flag + 1).map(psQuote).join(" ");
  return before + " $p" + (after ? " " + after : "");
}

function psQuote(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}
