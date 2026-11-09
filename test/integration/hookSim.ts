import { spawn } from "child_process";
import * as path from "path";

/**
 * Runs the real hook/notify.js the way Claude Code would: JSON on stdin,
 * COMPREHENSION_GUARD_HOME pointed at a throwaway folder.
 */
export function runNotify(
  repoRoot: string,
  guardHome: string,
  payload: unknown,
): Promise<number> {
  const script = path.join(repoRoot, "hook", "notify.js");
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, COMPREHENSION_GUARD_HOME: guardHome };
    // Inside the extension host process.execPath is Code.exe; run it as plain Node.
    let command = "node";
    if (process.versions.electron) {
      command = process.execPath;
      env.ELECTRON_RUN_AS_NODE = "1";
    }
    const child = spawn(command, [script], { env, stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? -1));
    child.stdin.end(JSON.stringify(payload));
  });
}

export function claudeWritePayloads(filePath: string, content: string, cwd: string): { pre: unknown; post: unknown } {
  const base = {
    session_id: "integration-test",
    transcript_path: "",
    cwd,
    tool_name: "Write",
    tool_input: { file_path: filePath, content },
  };
  return {
    pre: { ...base, hook_event_name: "PreToolUse" },
    post: {
      ...base,
      hook_event_name: "PostToolUse",
      tool_response: { type: "update", filePath, content },
    },
  };
}
