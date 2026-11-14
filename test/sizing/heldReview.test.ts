import assert from "node:assert/strict";
import test from "node:test";
import type { AgentEdit } from "../../src/agentProtocol";
import { checkShapeFor, collapseEdits, modelKindFor, planForEdits } from "../../src/heldReview";
import { analyzeFile } from "../../src/sizing/analyze";
import { planPreset } from "../../src/sizing/chunkPolicy";
import { draftPlan } from "../../src/sizing/plan";
import { unitsTouchedByEdit } from "../../src/sizing/touched";

const FIRST = `function once(fn) {
  let called = false;
  return function (...args) {
    if (!called) {
      called = true;
      return fn.apply(this, args);
    }
  };
}
`;

const SECOND = `function twice(fn) {
  return function (...args) {
    fn.apply(this, args);
    return fn.apply(this, args);
  };
}
`;

function edit(filePath: string, snippet: string, previous = ""): AgentEdit {
  const next = previous + snippet;
  return {
    agent: "claude-code",
    filePath,
    snippet,
    hunks: [{ oldText: previous, newText: snippet }],
    created: previous.length === 0,
    next,
    restore: { previous, next },
  };
}

test("quick and lenient checks cover the whole change; standard and deep walk chunks", () => {
  assert.equal(checkShapeFor({ preset: "quick" }), "general");
  assert.equal(checkShapeFor({ preset: "standard", strictness: "lenient" }), "general");
  assert.equal(checkShapeFor({ preset: "standard" }), "chunks");
  assert.equal(checkShapeFor({ preset: "deep" }), "chunks");
  assert.equal(checkShapeFor({ preset: "quick", strictness: "strict" }), "chunks");
});

test("collapseEdits keeps the original text and the file after the last write", () => {
  const collapsed = collapseEdits([
    edit("/ws/a.js", FIRST),
    edit("/ws/a.js", SECOND, FIRST),
    edit("/ws/b.js", FIRST),
  ]);
  assert.equal(collapsed.length, 2);
  const fileA = collapsed.find((item) => item.filePath.endsWith("a.js"));
  assert.equal(fileA?.restore?.previous, "");
  assert.equal(fileA?.restore?.next, FIRST + SECOND);
  assert.match(fileA?.snippet ?? "", /function once/);
  assert.match(fileA?.snippet ?? "", /function twice/);
});

function branched(name: string): string {
  return `function ${name}(x) {\n  if (x > 0) return 1;\n  if (x < 0) return -1;\n  return 0;\n}\n`;
}

function many(count: number): string {
  return Array.from({ length: count }, (_, index) => branched(`f${index}`)).join("\n");
}

function wide(name: string): string {
  const arms = Array.from({ length: 40 }, (_, index) => `  if (x === ${index}) return ${index};`).join("\n");
  return `function ${name}(x) {\n${arms}\n  return -1;\n}\n`;
}

async function treeSitterPlan(filePath: string, source: string, prefs: Parameters<typeof planPreset>[0]) {
  const analysis = await analyzeFile(filePath, source);
  const touched = unitsTouchedByEdit(analysis.units, {
    snippet: source,
    hunks: [{ newText: source }],
    created: true,
  });
  return draftPlan(touched, planPreset(prefs));
}

test("question count and type are the tree-sitter plan for the generated code", async () => {
  const source = many(8);
  const prefs = { preset: "standard" as const };
  const planned = await planForEdits([edit("/ws/a.js", source)], prefs);
  const plan = await treeSitterPlan("/ws/a.js", source, prefs);
  assert.equal(planned.chunks.length, plan.slots.length);
  assert.deepEqual(
    planned.chunks.map((chunk) => [chunk.unit, chunk.questionType, modelKindFor(chunk.questionType)]),
    plan.slots.map((slot) => [slot.unit, slot.type, modelKindFor(slot.type)]),
  );
  assert.ok(planned.chunks.length > 1);
  assert.ok(planned.chunks.every((chunk) => chunk.code.includes(`function ${chunk.unit}`)));
});

test("more generated code asks more questions, and a quick budget asks fewer", async () => {
  const small = await planForEdits([edit("/ws/a.js", many(1))], { preset: "standard" });
  const standard = await planForEdits([edit("/ws/a.js", many(8))], { preset: "standard" });
  const quick = await planForEdits([edit("/ws/a.js", many(8))], { preset: "quick" });
  assert.equal(small.chunks.length, 1);
  assert.ok(standard.chunks.length > small.chunks.length);
  assert.ok(quick.chunks.length > 0);
  assert.ok(quick.chunks.length < standard.chunks.length);
});

test("the same generated function gets the type the plan assigns for each preset", async () => {
  const source = wide("classify");
  const presets = ["quick", "standard", "deep"] as const;
  const types = [];
  for (const preset of presets) {
    const planned = await planForEdits([edit("/ws/a.js", source)], { preset });
    const plan = await treeSitterPlan("/ws/a.js", source, { preset });
    assert.equal(planned.chunks.length, plan.slots.length);
    assert.equal(planned.chunks[0]?.questionType, plan.slots[0]?.type);
    types.push(planned.chunks[0]?.questionType);
  }
  assert.equal(types[0], "ordering");
  assert.equal(types[1], "explain");
  assert.equal(types[2], "change");
  assert.equal(modelKindFor("ordering"), "ordering");
  assert.equal(modelKindFor("explain"), "free-text");
  assert.equal(modelKindFor("change"), "debug");
  assert.equal(modelKindFor("multiple_choice"), "multiple-choice");
});

test("a function tree-sitter scores at zero does not add a question", async () => {
  const planned = await planForEdits([edit("/ws/b.js", SECOND)], { preset: "standard" });
  assert.equal(planned.sawUnits, true);
  assert.equal(planned.chunks.length, 0);
});
