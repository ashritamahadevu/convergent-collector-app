import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFile } from "../../src/sizing/analyze";
import { emptyCheckpoint, needsCheckpoint, noteUnits } from "../../src/sizing/checkpoint";
import { unitsTouchedByEdit } from "../../src/sizing/touched";
import type { UnitFact } from "../../src/sizing/types";

const FILE = `
function oldKeep(x) {
  if (x) return x;
  return 0;
}

function coalesce(bp) {
  if (!prev) return bp;
  if (!next) return prev;
  return bp;
}
`;

const COALESCE = `function coalesce(bp) {
  if (!prev) return bp;
  if (!next) return prev;
  return bp;
}`;

function named(units: UnitFact[]): string[] {
  return units.map((unit) => unit.unit).sort();
}

test("a new function is the only unit that counts toward the pause", async () => {
  const analysis = await analyzeFile("mm.js", FILE, { aiShare: 1, mastery: 0.5 });
  const touched = unitsTouchedByEdit(analysis.units, {
    snippet: COALESCE,
    hunks: [{ newText: COALESCE }],
  });
  assert.deepEqual(named(touched), ["coalesce"]);
  const state = noteUnits(emptyCheckpoint("session", "standard"), touched);
  assert.equal(needsCheckpoint(state), true);
  assert.equal(needsCheckpoint(noteUnits(emptyCheckpoint("session", "quick"), touched)), false);
});

test("a one-line edit inside one function does not include the other", () => {
  const units: UnitFact[] = [
    fact("wide", "function wide() {\n  if (a) return 1;\n  return 0;\n}\n", 80),
    fact("tight", "function tight() {\n  if (flag) return 1;\n  return 0;\n}\n", 40),
  ];
  const touched = unitsTouchedByEdit(units, {
    snippet: "if (flag) return 1;",
    hunks: [{ newText: "if (flag) return 1;" }],
  });
  assert.deepEqual(named(touched), ["tight"]);
});

test("a created file keeps every logical unit", () => {
  const units = [fact("a", "function a() { if (x) return 1; }", 10), fact("b", "function b() { return 0; }", 8)];
  units[1] = { ...units[1], logic: 0, formulaValue: 0 };
  const touched = unitsTouchedByEdit(units, { created: true, snippet: "whole file" });
  assert.deepEqual(named(touched), ["a"]);
});

function fact(unit: string, code: string, lines: number): UnitFact {
  return {
    unit,
    file: "src/app.js",
    language: "javascript",
    kind: "function",
    startLine: 1,
    endLine: lines,
    lines,
    signature: "function " + unit,
    code,
    branches: 1,
    loops: 0,
    recursive: false,
    stateChanges: 0,
    calls: [],
    callers: [],
    riskTags: [],
    mastery: 0.5,
    aiShare: 1,
    centrality: 0,
    logic: 1,
    risk: 1,
    formulaValue: 1,
  };
}
