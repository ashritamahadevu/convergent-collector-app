import assert from "node:assert/strict";
import test from "node:test";
import { chooseChunk, chunkGuidance, chunkSizeFor, questionKind } from "../../src/sizing/chunkPolicy";
import { questionForChunk } from "../../src/sizing/questions";
import type { UnitFact } from "../../src/sizing/types";

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
    code: "function sum(xs: number[]) { return xs.length; }",
    branches: 2,
    loops: 1,
    recursive: false,
    stateChanges: 1,
    calls: ["push", "check"],
    callers: [],
    riskTags: [],
    mastery: 0.5,
    aiShare: 1,
    centrality: 0.2,
    logic: 3.5,
    risk: 1,
    formulaValue: 2,
    ...overrides,
  };
}

const NOW = Date.parse("2026-11-11T00:00:00Z");

test("chooseChunk returns one unit, the higher value one", () => {
  const low = fact({ unit: "low", formulaValue: 1 });
  const high = fact({ unit: "high", formulaValue: 4, file: "src/b.ts" });
  const choice = chooseChunk([low, high], { preset: "standard", now: NOW });
  assert.equal(choice?.unit.unit, "high");
  assert.equal(choice?.questionType, "predict");
});

test("lenient always asks multiple choice", () => {
  const unit = fact({ formulaValue: 9, mastery: 0.1 });
  assert.equal(questionKind(unit, { preset: "deep", strictness: "lenient", now: NOW }), "multiple_choice");
});

test("standard uses explain when mastery is low and predict when it is not", () => {
  const unit = fact({ formulaValue: 3, mastery: 0.2 });
  assert.equal(questionKind(unit, { preset: "standard", now: NOW }), "explain");
  assert.equal(questionKind(fact({ formulaValue: 3, mastery: 0.6 }), { preset: "standard", now: NOW }), "predict");
});

test("deep asks for a change when the chunk is large", () => {
  assert.equal(questionKind(fact({ formulaValue: 8 }), { preset: "deep", now: NOW }), "change");
  assert.equal(questionKind(fact({ formulaValue: 3, mastery: 0.2 }), { preset: "deep", now: NOW }), "explain");
});

test("strict steps a quick preset to its deepest question and still asks a known chunk", () => {
  const unit = fact({ mastery: 0.95, formulaValue: 2, branches: 2, loops: 1 });
  assert.equal(questionKind(unit, { preset: "quick", strictness: "strict", now: NOW }), "ordering");
  assert.ok(chooseChunk([unit], { preset: "standard", strictness: "strict", masteryByConcept: { "control-flow": 0.95 }, now: NOW }));
});

test("an exam within 14 days steps quick up to standard", () => {
  const examDate = "2026-11-18";
  const unit = fact({ formulaValue: 2, mastery: 0.55 });
  assert.equal(questionKind(unit, { preset: "quick", examDate, now: NOW }), "predict");
});

test("a mastered chunk is skipped unless the check is strict, deep, or close to an exam", () => {
  const unit = fact({ mastery: 0.9, formulaValue: 2 });
  assert.equal(chooseChunk([unit], { preset: "quick", now: NOW }), null);
  assert.equal(chooseChunk([unit], { preset: "standard", now: NOW }), null);
  assert.ok(chooseChunk([unit], { preset: "deep", now: NOW }));
  assert.ok(chooseChunk([unit], { preset: "quick", examDate: "2026-11-18", now: NOW }));
});

test("the question names the kind and the preferred language, and stays locally gradeable", () => {
  const unit = fact({ unit: "coalesce", file: "src/mm.ts" });
  const choice = chooseChunk([unit], { preset: "standard", preferredLanguage: "Spanish", now: NOW });
  assert.ok(choice);
  const question = questionForChunk(choice, { preset: "standard", preferredLanguage: "Spanish", now: NOW });
  assert.equal(question.type, "multiple_choice");
  assert.match(question.prompt, /^Predict the control flow of coalesce/);
  assert.match(question.prompt, /Answer in Spanish\.$/);
  assert.equal(question.options.includes(question.explanation), true);
});

test("the model chooses a file, a function, or a fragment inside a method", () => {
  assert.equal(chunkSizeFor({ preset: "quick", now: NOW }), "file");
  assert.equal(chunkSizeFor({ preset: "standard", strictness: "lenient", now: NOW }), "file");
  assert.equal(chunkSizeFor({ preset: "standard", now: NOW }), "function");
  assert.equal(chunkSizeFor({ preset: "deep", now: NOW }), "fragment");
  assert.equal(chunkSizeFor({ preset: "quick", strictness: "strict", now: NOW }), "fragment");
  assert.equal(chunkSizeFor({ preset: "quick", examDate: "2026-11-18", now: NOW }), "fragment");
  const message = chunkGuidance({ preset: "standard", strictness: "strict", preferredLanguage: "Hindi", now: NOW });
  assert.match(message, /You choose the next chunk/);
  assert.match(message, /few lines inside a large method/);
  assert.match(message, /Hindi/);
  assert.equal(message.includes("{"), false);
});
