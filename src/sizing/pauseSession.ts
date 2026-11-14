import { analyzeFile } from "./analyze";
import { chooseChunk, chunkGuidance, nextChunkMessage, type LearnerPreferences } from "./chunkPolicy";
import { clearUnits, emptyCheckpoint, noteUnits } from "./checkpoint";
import { isMutatingTool } from "./decide";
import { questionForChunk } from "./questions";
import { unitsTouchedByEdit, type TouchEdit } from "./touched";
import type { CheckpointState, IncomingTool, LocalQuestion, UnitFact } from "./types";

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
  preferences: LearnerPreferences;
};

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
    preferences: LearnerPreferences,
    filePath: string,
    source: string,
    edit: TouchEdit,
  ): Promise<void> {
    try {
      const analysis = await analyzeFile(filePath, source, { aiShare: 1, mastery: 0.5 });
      this.observe(sessionId, preferences, unitsTouchedByEdit(analysis.units, edit));
    } catch {
      // A parser failure must not trap the agent.
    }
  }

  observe(sessionId: string, preferences: LearnerPreferences, units: UnitFact[]): void {
    const checkpoint = noteUnits(this.checkpointFor(sessionId, preferences.preset), units);
    this.checkpoints.set(sessionId, checkpoint);
    this.open(sessionId, preferences);
  }

  async onPause(body: unknown, control: PauseControl): Promise<PauseWire> {
    try {
      if (!control.enabled) {
        return allow("continue", "", "");
      }
      await this.pending;
      const sessionId = pauseSessionId(body);
      const tool = incomingTool(hookPayload(body));
      if (!tool.mutating) {
        return allow("not-mutating", "No check on this step.", "This tool does not change files. Continue.");
      }
      let justPassed = false;
      if (this.inflight) {
        const passed = await this.inflight;
        if (!passed) {
          return deny();
        }
        justPassed = true;
      }
      const checkpoint = this.checkpointFor(sessionId, control.preferences.preset);
      const choice = chooseChunk(checkpoint.uncleared, control.preferences);
      if (choice) {
        const passed = await this.startAsk(sessionId, [questionForChunk(choice, control.preferences)]);
        if (!passed) {
          return deny();
        }
        justPassed = true;
      }
      return allow(
        justPassed ? "passed" : "continue",
        justPassed ? "Comprehension Guard: check passed. The agent can continue." : "",
        justPassed ? nextChunkMessage(control.preferences) : chunkGuidance(control.preferences),
      );
    } catch {
      return allow("continue", "", "");
    }
  }

  private checkpointFor(sessionId: string, preset: LearnerPreferences["preset"]): CheckpointState {
    let checkpoint = this.checkpoints.get(sessionId) ?? emptyCheckpoint(sessionId, preset);
    if (checkpoint.preset !== preset) {
      checkpoint = { ...checkpoint, preset };
    }
    this.checkpoints.set(sessionId, checkpoint);
    return checkpoint;
  }

  private open(sessionId: string, preferences: LearnerPreferences): void {
    if (this.inflight) {
      return;
    }
    const checkpoint = this.checkpoints.get(sessionId);
    if (!checkpoint) {
      return;
    }
    const choice = chooseChunk(checkpoint.uncleared, preferences);
    if (!choice) {
      return;
    }
    void this.startAsk(sessionId, [questionForChunk(choice, preferences)]).catch(() => undefined);
  }

  private startAsk(sessionId: string, questions: LocalQuestion[]): Promise<boolean> {
    if (this.inflight) {
      return this.inflight;
    }
    const run = this.ask(questions).then((passed) => {
      if (passed) {
        const current = this.checkpoints.get(sessionId);
        if (current) {
          this.checkpoints.set(sessionId, clearUnits(current, current.uncleared));
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
    stringField(payload, "conversationId") ||
    stringField(record, "session_id") ||
    stringField(record, "sessionId") ||
    stringField(record, "conversation_id") ||
    stringField(record, "conversationId");
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
