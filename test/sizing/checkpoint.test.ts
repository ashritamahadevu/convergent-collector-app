import assert from "node:assert/strict";
import test from "node:test";
import {
  clearUnits,
  emptyCheckpoint,
  needsCheckpoint,
  noteUnits,
  pauseThreshold,
  unclearedValue,
  unitFingerprint,
} from "../../src/sizing/checkpoint";
import type { CheckPreset, CheckpointState, UnitFact } from "../../src/sizing/types";

function fact(overrides: Partial<UnitFact> = {}): UnitFact {
  return {
    unit: "sum",
    file: "src/math.ts",
    language: "ts",
    kind: "function",
    startLine: 1,
    endLine: 12,
    lines: 12,
    signature: "function sum(xs: number[])",
    code: "function sum(xs: number[]) {\n  let total = 0;\n  for (const x of xs) {\n    if (x > 0) total += x;\n  }\n  return total;\n}\n",
    branches: 2,
    loops: 1,
    recursive: false,
    stateChanges: 1,
    calls: [],
    callers: [],
    riskTags: [],
    mastery: 0.4,
    aiShare: 1,
    centrality: 0.2,
    logic: 1,
    risk: 1,
    formulaValue: 1,
    ...overrides,
  };
}

function checkpoint(
  preset: CheckPreset,
  uncleared: UnitFact[] = [],
  cleared: string[] = [],
): CheckpointState {
  return {
    sessionId: "session-1",
    preset,
    uncleared,
    cleared,
  };
}

test("noteUnits drops logic 0 and already-cleared fingerprints", () => {
  const good = fact({
    unit: "good",
    file: "src/good.ts",
    startLine: 4,
    endLine: 18,
    logic: 2,
    formulaValue: 1.5,
  });
  const noLogic = fact({
    unit: "markup",
    file: "src/view.tsx",
    startLine: 1,
    endLine: 8,
    logic: 0,
    formulaValue: 5,
  });
  const noValue = fact({
    unit: "student",
    file: "src/student.ts",
    startLine: 2,
    endLine: 9,
    logic: 3,
    formulaValue: 0,
  });
  const negative = fact({
    unit: "neg",
    file: "src/neg.ts",
    startLine: 1,
    endLine: 3,
    logic: -1,
    formulaValue: 4,
  });
  const already = fact({
    unit: "old",
    file: "src/old.ts",
    startLine: 10,
    endLine: 20,
    logic: 2,
    formulaValue: 4,
  });
  const seeded = checkpoint("quick", [], [unitFingerprint(already)]);
  const incoming = [good, noLogic, noValue, negative, already];
  const next = noteUnits(seeded, incoming);

  assert.equal(unitFingerprint(good), "src/good.ts:good:4:18");
  assert.deepEqual(
    next.uncleared.map((unit) => unit.unit),
    ["good"],
  );
  assert.equal(next.uncleared[0], good);
  assert.equal(next.sessionId, seeded.sessionId);
  assert.equal(next.preset, "quick");
  assert.notEqual(next.cleared, seeded.cleared);
  assert.deepEqual(next.cleared, [unitFingerprint(already)]);
  assert.deepEqual(seeded.uncleared, []);
  assert.equal(incoming.length, 5);
  next.cleared.push("extra");
  assert.deepEqual(seeded.cleared, [unitFingerprint(already)]);

  const replaced = fact({
    unit: "good",
    file: "src/good.ts",
    startLine: 4,
    endLine: 18,
    logic: 4,
    formulaValue: 2.5,
  });
  const other = fact({
    unit: "other",
    file: "src/other.ts",
    startLine: 1,
    endLine: 4,
    logic: 1,
    formulaValue: 1,
  });
  const updated = noteUnits(next, [replaced, other]);
  assert.deepEqual(
    updated.uncleared.map((unit) => [unit.unit, unit.formulaValue]),
    [
      ["good", 2.5],
      ["other", 1],
    ],
  );
  assert.equal(next.uncleared[0].formulaValue, 1.5);
});

test("needsCheckpoint is false under the standard threshold and true at or above 0.5", () => {
  assert.equal(pauseThreshold("standard"), 0.5);
  const under = checkpoint("standard", [fact({ formulaValue: 0.4, logic: 1 })]);
  assert.equal(unclearedValue(under), 0.4);
  assert.equal(needsCheckpoint(under), false);

  const exact = checkpoint("standard", [fact({ formulaValue: 0.5, logic: 1 })]);
  assert.equal(needsCheckpoint(exact), true);

  const above = checkpoint("standard", [fact({ formulaValue: 0.6, logic: 2 })]);
  assert.equal(needsCheckpoint(above), true);

  const summed = noteUnits(emptyCheckpoint("session-1", "standard"), [
    fact({ unit: "left", file: "a.ts", startLine: 1, endLine: 4, formulaValue: 0.2, logic: 1 }),
    fact({ unit: "right", file: "b.ts", startLine: 1, endLine: 4, formulaValue: 0.3, logic: 1 }),
  ]);
  assert.equal(unclearedValue(summed), 0.5);
  assert.equal(needsCheckpoint(summed), true);

  const justUnder = noteUnits(emptyCheckpoint("session-1", "standard"), [
    fact({ unit: "left", file: "a.ts", startLine: 1, endLine: 4, formulaValue: 0.2, logic: 1 }),
    fact({ unit: "right", file: "b.ts", startLine: 1, endLine: 4, formulaValue: 0.2, logic: 1 }),
  ]);
  assert.equal(unclearedValue(justUnder), 0.4);
  assert.equal(needsCheckpoint(justUnder), false);

  const withZero = checkpoint("standard", [
    fact({ unit: "hot", formulaValue: 0.2, logic: 1 }),
    fact({ unit: "cold", file: "c.ts", startLine: 3, endLine: 5, formulaValue: 0.2, logic: 0 }),
  ]);
  assert.equal(unclearedValue(withZero), 0.4);
  assert.equal(needsCheckpoint(withZero), false);
});

test("deep pauses when a single unit has formulaValue 0.5 and logic 1", () => {
  assert.equal(pauseThreshold("deep"), 0.1);
  const state = noteUnits(emptyCheckpoint("session-1", "deep"), [
    fact({ formulaValue: 0.5, logic: 1 }),
  ]);
  assert.equal(unclearedValue(state), 0.5);
  assert.equal(needsCheckpoint(state), true);

  const rounded = noteUnits(emptyCheckpoint("session-1", "deep"), [
    fact({ unit: "a", file: "a.ts", startLine: 1, endLine: 2, formulaValue: 0.1, logic: 1 }),
    fact({ unit: "b", file: "b.ts", startLine: 3, endLine: 4, formulaValue: 0.2, logic: 1 }),
  ]);
  assert.equal(unclearedValue(rounded), 0.3);
  assert.equal(needsCheckpoint(rounded), true);
});

test("quick does not pause at formulaValue 1.9 and does at 2", () => {
  assert.equal(pauseThreshold("quick"), 2);
  const below = noteUnits(emptyCheckpoint("session-1", "quick"), [
    fact({ formulaValue: 1.9, logic: 4 }),
  ]);
  assert.equal(unclearedValue(below), 1.9);
  assert.equal(needsCheckpoint(below), false);

  const at = noteUnits(emptyCheckpoint("session-1", "quick"), [
    fact({ formulaValue: 2, logic: 4 }),
  ]);
  assert.equal(unclearedValue(at), 2);
  assert.equal(needsCheckpoint(at), true);
});

test("clearUnits removes the unit and a later noteUnits does not bring it back", () => {
  const kept = fact({
    unit: "keep",
    file: "src/keep.ts",
    startLine: 1,
    endLine: 6,
    formulaValue: 2,
    logic: 1,
  });
  const gone = fact({
    unit: "gone",
    file: "src/gone.ts",
    startLine: 8,
    endLine: 20,
    formulaValue: 2,
    logic: 1,
  });
  const before = noteUnits(emptyCheckpoint("session-1", "standard"), [kept, gone]);
  const unclearedBefore = before.uncleared.slice();
  const clearedBefore = before.cleared.slice();
  const cleared = clearUnits(before, [gone]);

  assert.deepEqual(before.uncleared, unclearedBefore);
  assert.deepEqual(before.cleared, clearedBefore);
  assert.deepEqual(
    cleared.uncleared.map((unit) => unit.unit),
    ["keep"],
  );
  assert.deepEqual(cleared.cleared, [unitFingerprint(gone)]);

  const revived = fact({
    unit: "gone",
    file: "src/gone.ts",
    startLine: 8,
    endLine: 20,
    formulaValue: 9,
    logic: 5,
  });
  const after = noteUnits(cleared, [revived, kept]);
  assert.deepEqual(
    after.uncleared.map((unit) => unit.unit),
    ["keep"],
  );
  assert.ok(after.cleared.includes(unitFingerprint(gone)));
});

test("isMutatingTool matches the mutating names and ignores reads", async () => {
  const { isMutatingTool } = await import("../../src/sizing/decide");
  const mutating = [
    "Edit",
    "write",
    "MultiEdit",
    "multi-edit",
    "multi_edit",
    "NotebookEdit",
    "edit_notebook",
    "Edit Notebook",
    "apply-patch",
    "ApplyPatch",
    "StrReplace",
    "search_replace",
    "search replace",
    "Delete",
    "bash",
    "Shell",
    "PowerShell",
    "exec",
    "WriteFile",
    "write-file",
    "STR_REPLACE",
  ];
  for (const name of mutating) {
    assert.equal(isMutatingTool(name), true, name);
  }
  for (const name of ["", "   ", "Read", "Grep", "Glob", "WebSearch", "WebFetch", "Task", "read_file"]) {
    assert.equal(isMutatingTool(name), false, name);
  }
});

test("decide allows a Read tool even when the checkpoint is due", async () => {
  const { decide } = await import("../../src/sizing/decide");
  const state = checkpoint("standard", [fact({ formulaValue: 6, logic: 2 })]);
  assert.equal(needsCheckpoint(state), true);
  const decision = decide(state, { toolName: "Read", mutating: false });
  assert.equal(decision.allow, true);
  assert.equal(decision.reason, "not-mutating");
  assert.deepEqual(decision.units, []);
  assert.equal(decision.plan, null);
  assert.ok(decision.userMessage.length > 0);
  assert.ok(decision.agentMessage.length > 0);

  const namedWrite = decide(state, { toolName: "Write", mutating: false, filePath: "src/math.ts" });
  assert.equal(namedWrite.allow, true);
  assert.equal(namedWrite.reason, "not-mutating");
  assert.equal(namedWrite.plan, null);
});

test("decide returns checkpoint, with a plan, when a Write arrives and standard value is past the threshold", async () => {
  const { decide } = await import("../../src/sizing/decide");
  const hot = fact({
    unit: "parse",
    file: "src/parse.ts",
    formulaValue: 4,
    logic: 2,
    branches: 2,
    loops: 1,
  });
  const cold = fact({
    unit: "sheet",
    file: "src/sheet.css",
    startLine: 1,
    endLine: 4,
    formulaValue: 1,
    logic: 0,
  });
  const state = checkpoint("standard", [cold, hot]);
  const decision = decide(state, { toolName: "Write", mutating: true, filePath: "src/parse.ts" });
  assert.equal(decision.allow, false);
  assert.equal(decision.reason, "checkpoint");
  assert.deepEqual(
    decision.units.map((unit) => unit.unit),
    ["parse"],
  );
  assert.ok(decision.plan);
  assert.equal(
    decision.userMessage,
    "Answer a short check on the code just written, then the agent continues.",
  );
  assert.equal(
    decision.agentMessage,
    "Comprehension Guard paused this write. The student is answering a check on the previous code. Wait, then retry the same edit.",
  );

  const unknown = decide(state, { toolName: "StudentEdit", mutating: true });
  assert.equal(unknown.allow, false);
  assert.equal(unknown.reason, "checkpoint");
  assert.ok(unknown.plan);
});

test("decide allows Write when value is below the threshold", async () => {
  const { decide } = await import("../../src/sizing/decide");
  const state = noteUnits(emptyCheckpoint("session-1", "standard"), [
    fact({ formulaValue: 0.4, logic: 1 }),
  ]);
  assert.equal(needsCheckpoint(state), false);
  const decision = decide(state, { toolName: "Write", mutating: true, filePath: "src/math.ts" });
  assert.equal(decision.allow, true);
  assert.equal(decision.reason, "below-threshold");
  assert.deepEqual(decision.units, []);
  assert.equal(decision.plan, null);
  assert.ok(decision.userMessage.length > 0);
  assert.ok(decision.agentMessage.length > 0);
});
