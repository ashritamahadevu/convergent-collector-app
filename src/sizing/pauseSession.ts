import { analyzeFile } from "./analyze";
import { clearUnits, emptyCheckpoint, needsCheckpoint, noteUnits } from "./checkpoint";
import { decide, isMutatingTool } from "./decide";
import { questionsFor } from "./questions";
import { unitsTouchedByEdit, type TouchEdit } from "./touched";
import type { CheckPreset, CheckpointState, IncomingTool, LocalQuestion, UnitFact } from "./types";

/**
 * One student's pause gate.
 *
 * An allow returns the tool the model already chose. A deny adds one short
 * reason and leaves that choice unchanged. The quiz text stays in the editor.
 */

export type PauseWire = {
  allow: boolean;
  reason: string;
  userMessage: string;
  agentMessage: string;
};

export type PauseAsk = (questions: LocalQuestion[]) => Promise<boolean>;

export type PauseControl = {
  enabled: boolean;
  preset: CheckPreset;
};

const PASS_MESSAGE = "The comprehension check passed. Continue.";
const FAIL_MESSAGE =
  "Comprehension Guard paused this write. The student is answering a check on the previous code. Wait, then retry the same edit.";

export class PauseSession {
  private readonly checkpoints = new Map<string, CheckpointState>();
  private inflight: Promise<boolean> | null = null;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly ask: PauseAsk) {}

  /** A post-edit analysis the next pause must see before it decides. */
  track(work: Promise<void>): void {
    this.pending = this.pending.then(() => work, () => work);
  }

  async noteFile(
    sessionId: string,
    preset: CheckPreset,
    filePath: string,
    source: string,
    edit: TouchEdit,
  ): Promise<void> {
    try {
      const analysis = await analyzeFile(filePath, source, { aiShare: 1, mastery: 0.5 });
      this.observe(sessionId, preset, unitsTouchedByEdit(analysis.units, edit));
    } catch {
      // A parser failure must not trap the agent.
    }
  }

  observe(sessionId: string, preset: CheckPreset, units: UnitFact[]): void {
    const checkpoint = noteUnits(this.checkpointFor(sessionId, preset), units);
    this.checkpoints.set(sessionId, checkpoint);
    if (needsCheckpoint(checkpoint)) {
      this.open(sessionId, checkpoint);
    }
  }

  async onPause(body: unknown, control: PauseControl): Promise<PauseWire> {
    try {
      if (!control.enabled) {
        return allow("continue", "", "");
      }
      await this.pending;
      const sessionId = pauseSessionId(body);
      const tool = incomingTool(hookPayload(body));
      if (this.inflight) {
        const passed = await this.inflight;
        if (!passed) {
          return deny();
        }
      }
      const checkpoint = this.checkpointFor(sessionId, control.preset);
      const decision = decide(checkpoint, tool);
      if (decision.reason !== "checkpoint" || !decision.plan || !needsCheckpoint(checkpoint)) {
        return {
          allow: decision.allow,
          reason: decision.reason,
          userMessage: decision.userMessage,
          agentMessage: decision.agentMessage,
        };
      }
      const units = decision.units.length > 0 ? decision.units : checkpoint.uncleared;
      const passed = await this.startAsk(sessionId, questionsFor(decision.plan, units), units);
      return passed ? allow("passed", decision.userMessage, PASS_MESSAGE) : deny();
    } catch {
      return allow("continue", "", "");
    }
  }

  private checkpointFor(sessionId: string, preset: CheckPreset): CheckpointState {
    let checkpoint = this.checkpoints.get(sessionId) ?? emptyCheckpoint(sessionId, preset);
    if (checkpoint.preset !== preset) {
      checkpoint = { ...checkpoint, preset };
    }
    this.checkpoints.set(sessionId, checkpoint);
    return checkpoint;
  }

  private open(sessionId: string, checkpoint: CheckpointState): void {
    if (this.inflight || !needsCheckpoint(checkpoint)) {
      return;
    }
    const filePath = checkpoint.uncleared.find((unit) => unit.logic > 0)?.file;
    let decision;
    try {
      decision = decide(checkpoint, { toolName: "Edit", mutating: true, filePath });
    } catch {
      return;
    }
    if (decision.reason !== "checkpoint" || !decision.plan) {
      return;
    }
    const units = decision.units.length > 0 ? decision.units : checkpoint.uncleared;
    void this.startAsk(sessionId, questionsFor(decision.plan, units), units).catch(() => undefined);
  }

  private startAsk(sessionId: string, questions: LocalQuestion[], units: UnitFact[]): Promise<boolean> {
    if (this.inflight) {
      return this.inflight;
    }
    const run = this.ask(questions).then((passed) => {
      if (passed) {
        const current = this.checkpoints.get(sessionId);
        if (current) {
          this.checkpoints.set(sessionId, clearUnits(current, units));
        }
      }
      return passed;
    });
    this.inflight = run.finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }
}

function allow(reason: string, userMessage: string, agentMessage: string): PauseWire {
  return { allow: true, reason, userMessage, agentMessage };
}

function deny(): PauseWire {
  return {
    allow: false,
    reason: "failed",
    userMessage: "Answer a short check on the code just written, then the agent continues.",
    agentMessage: FAIL_MESSAGE,
  };
}

function hookPayload(body: unknown): Record<string, unknown> {
  const record = asRecord(body);
  if (!record) {
    return {};
  }
  return asRecord(parseMaybe(record.payload)) ?? record;
}

export function pauseSessionId(body: unknown): string {
  const record = asRecord(body);
  const payload = hookPayload(body);
  const id =
    stringField(payload, "session_id") ||
    stringField(payload, "sessionId") ||
    stringField(payload, "conversation_id") ||
    stringField(record, "session_id") ||
    stringField(record, "sessionId") ||
    stringField(record, "conversation_id");
  return id || "default";
}

function incomingTool(payload: Record<string, unknown>): IncomingTool {
  const toolName = toolNameOf(payload);
  const filePath = filePathOf(payload);
  const tool: IncomingTool = {
    toolName,
    mutating: isMutatingTool(toolName),
  };
  if (filePath) {
    tool.filePath = filePath;
  }
  return tool;
}

function toolNameOf(payload: Record<string, unknown>): string {
  const direct = stringField(payload, "tool_name") || stringField(payload, "toolName");
  if (direct) {
    return direct;
  }
  const input = asRecord(parseMaybe(payload.tool_input ?? payload.toolInput));
  return stringField(input, "tool");
}

function filePathOf(payload: Record<string, unknown>): string {
  const input = asRecord(parseMaybe(payload.tool_input ?? payload.toolInput));
  return (
    stringField(input, "file_path") ||
    stringField(input, "filePath") ||
    stringField(input, "path") ||
    stringField(payload, "file_path") ||
    stringField(payload, "filePath") ||
    stringField(payload, "path")
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function parseMaybe(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function stringField(record: Record<string, unknown> | undefined, key: string): string {
  if (!record) {
    return "";
  }
  const value = record[key];
  return typeof value === "string" ? value : "";
}
