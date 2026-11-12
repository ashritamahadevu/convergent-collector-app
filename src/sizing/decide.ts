import { needsCheckpoint } from "./checkpoint";
import { draftPlan } from "./plan";
import type { CheckpointState, IncomingTool, PauseDecision } from "./types";

/**
 * Decides whether the next tool call waits for a comprehension check.
 * A caller flag of false always proceeds. A flag of true pauses once
 * uncleared value reaches the preset threshold.
 */

const MUTATING_TOOLS = new Set([
  "edit",
  "write",
  "multiedit",
  "notebookedit",
  "applypatch",
  "strreplace",
  "delete",
  "bash",
  "shell",
  "powershell",
  "exec",
  "editnotebook",
  "searchreplace",
  "writefile",
  "replace",
  "create",
  "writetofile",
  "replacefilecontent",
  "multireplacefilecontent",
]);

function normalizeToolName(toolName: string): string {
  return toolName.toLowerCase().replace(/[_\- ]/g, "");
}

export function isMutatingTool(toolName: string): boolean {
  if (!toolName) return false;
  const normalized = normalizeToolName(toolName);
  if (!normalized) return false;
  return MUTATING_TOOLS.has(normalized);
}

function allow(
  reason: "not-mutating" | "below-threshold",
  userMessage: string,
  agentMessage: string,
): PauseDecision {
  return {
    allow: true,
    reason,
    userMessage,
    agentMessage,
    units: [],
    plan: null,
  };
}

export function decide(state: CheckpointState, tool: IncomingTool): PauseDecision {
  // False wins, even when the name is Write or Bash.
  // True stays mutating even when the name is not in the list.
  if (tool.mutating === false) {
    return allow(
      "not-mutating",
      "No check on this step.",
      "This tool does not change files. Continue.",
    );
  }
  if (!needsCheckpoint(state)) {
    return allow(
      "below-threshold",
      "No check yet.",
      "Uncleared value is under the pause threshold. Continue.",
    );
  }
  const units = state.uncleared.filter((unit) => unit.logic > 0);
  return {
    allow: false,
    reason: "checkpoint",
    userMessage: "Answer a short check on the code just written, then the agent continues.",
    agentMessage:
      "Comprehension Guard paused this write. The student is answering a check on the previous code. Wait, then retry the same edit.",
    units,
    plan: draftPlan(units, state.preset),
  };
}
