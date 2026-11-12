import { analyzeFile } from "./analyze";
import { chooseChunk, nextChunkMessage, oneChunkMessage, type LearnerPreferences } from "./chunkPolicy";
import { clearUnits, emptyCheckpoint, noteUnits, unitFingerprint } from "./checkpoint";
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
      let checkpoint = this.checkpointFor(sessionId, control.preferences.preset);
      let choice = chooseChunk(checkpoint.uncleared, control.preferences);
      while (choice) {
        const passed = await this.startAsk(
          sessionId,
          [questionForChunk(choice, control.preferences)],
          [choice.unit],
        );
        if (!passed) {
          return deny();
        }
        justPassed = true;
        checkpoint = this.checkpointFor(sessionId, control.preferences.preset);
        choice = chooseChunk(checkpoint.uncleared, control.preferences);
      }
      const extras = await this.incomingNewUnits(sessionId, body);
      if (extras.length >= 2) {
        return {
          allow: false,
          reason: "one-chunk",
          userMessage: "Write one function at a time.",
          agentMessage: oneChunkMessage(control.preferences, extras.length),
        };
      }
      return allow(
        justPassed ? "passed" : "continue",
        justPassed ? "Comprehension Guard: check passed. The agent can continue." : "",
        justPassed ? nextChunkMessage(control.preferences) : "",
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
    void this.startAsk(sessionId, [questionForChunk(choice, preferences)], [choice.unit]).catch(() => undefined);
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

  /** Units in this tool call that are not already waiting or already cleared. */
  private async incomingNewUnits(sessionId: string, body: unknown): Promise<UnitFact[]> {
    const payload = hookPayload(body);
    const input = asRecord(parseMaybe(payload.tool_input ?? payload.toolInput)) ?? {};
    const snippet =
      stringField(input, "new_string") || stringField(input, "newString") || stringField(input, "patch");
    const content = stringField(input, "content");
    const text = snippet || content;
    if (!text || text.trim().length < 8) {
      return [];
    }
    const file = filePathOf(payload) || "chunk";
    const analysis = await analyzeFile(file, text, { aiShare: 1, mastery: 0.5 });
    let units = analysis.units.filter((unit) => unit.logic > 0 && unit.formulaValue > 0);
    if (!snippet && content) {
      const known = this.knownFingerprints(sessionId);
      units = units.filter((unit) => !known.has(unitFingerprint(unit)));
    }
    return units;
  }

  private knownFingerprints(sessionId: string): Set<string> {
    const checkpoint = this.checkpoints.get(sessionId);
    const known = new Set<string>();
    if (!checkpoint) {
      return known;
    }
    for (const fingerprint of checkpoint.cleared) {
      known.add(fingerprint);
    }
    for (const unit of checkpoint.uncleared) {
      known.add(unitFingerprint(unit));
    }
    return known;
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
