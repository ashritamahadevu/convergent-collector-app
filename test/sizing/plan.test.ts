import assert from "node:assert/strict";
import test from "node:test";
import { applyAdjustment, draftPlan } from "../../src/sizing/plan";
import type { CheckPreset, UnitFact } from "../../src/sizing/types";

function unit(over: Partial<UnitFact> & { unit: string }): UnitFact {
  const name = over.unit;
  return {
    unit: name,
    file: "src/app.ts",
    language: "typescript",
    kind: "function",
    startLine: 1,
    endLine: 12,
    lines: 12,
    signature: `function ${name}(): void`,
    code: "return;",
    branches: 0,
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
    ...over,
  };
}

test("empty units produce an empty plan", () => {
  const plan = draftPlan([], "standard");
  assert.deepEqual(plan, {
    preset: "standard",
    slots: [],
    sessions: 1,
    estimatedSeconds: 0,
    coverage: 0,
    totalValue: 0,
  });
});

test("logic or formula value of zero contributes nothing", () => {
  const plan = draftPlan(
    [
      unit({ unit: "dead", logic: 0, formulaValue: 9 }),
      unit({ unit: "zero", logic: 4, formulaValue: 0 }),
    ],
    "deep",
  );
  assert.equal(plan.slots.length, 0);
  assert.equal(plan.totalValue, 0);
  assert.equal(plan.sessions, 1);
  assert.equal(plan.coverage, 0);
});

test("a single high-logic unit on standard stays inside 300 seconds", () => {
  const plan = draftPlan(
    [unit({ unit: "parse", formulaValue: 6, logic: 4, branches: 2, riskTags: ["auth", "sql"] })],
    "standard",
  );
  assert.ok(plan.slots.length >= 1);
  assert.ok(plan.estimatedSeconds <= 300);
  assert.equal(plan.slots[0].type, "explain");
  assert.equal(plan.slots[0].points, 7);
  assert.equal(plan.slots[0].estimatedSeconds, 90);
  assert.equal(plan.slots[0].concept, "api-semantics");
  assert.equal(plan.slots[0].keyIdea, "function parse(): void");
  assert.equal(plan.coverage, 1);
  assert.equal(plan.sessions, 1);
});

test("quick never emits predict, explain, or change", () => {
  const plan = draftPlan(
    [
      unit({ unit: "a", file: "a.ts", formulaValue: 12, logic: 5, branches: 3, loops: 1 }),
      unit({ unit: "b", file: "b.ts", formulaValue: 9, logic: 4, calls: ["left", "right"] }),
      unit({ unit: "c", file: "c.ts", formulaValue: 5, logic: 2 }),
      unit({ unit: "d", file: "d.ts", formulaValue: 1, logic: 1 }),
    ],
    "quick",
  );
  assert.ok(plan.slots.length >= 1);
  assert.ok(plan.estimatedSeconds <= 120);
  for (const slot of plan.slots) {
    assert.ok(slot.type === "ordering" || slot.type === "multiple_choice");
  }
  assert.deepEqual(
    plan.slots.map((slot) => slot.type),
    ["ordering", "ordering", "multiple_choice", "multiple_choice"],
  );
});

test("quick packs ordering questions without passing 120 seconds", () => {
  const units = [0, 1, 2, 3, 4].map((index) =>
    unit({
      unit: `big${index}`,
      file: `big${index}.ts`,
      formulaValue: 100 - index,
      logic: 5,
      branches: 2,
      loops: 1,
    }),
  );
  const plan = draftPlan(units, "quick");
  const forced =
    plan.slots.length === 1 && plan.slots[0].type === "multiple_choice" && plan.estimatedSeconds > 120;
  assert.ok(plan.estimatedSeconds <= 120 || forced);
  assert.equal(plan.estimatedSeconds, 120);
  assert.equal(plan.slots.length, 4);
  assert.ok(plan.slots.every((slot) => slot.type === "ordering"));
});

test("deep emits change only when formula value is at least 8 and it fits", () => {
  const high = draftPlan([unit({ unit: "big", formulaValue: 8, logic: 5 })], "deep");
  assert.equal(high.slots[0].type, "change");
  assert.equal(high.slots[0].points, 10);
  assert.equal(high.slots[0].estimatedSeconds, 180);

  const below = draftPlan([unit({ unit: "mid", formulaValue: 7.9, logic: 5, branches: 2 })], "deep");
  assert.equal(below.slots[0].type, "explain");

  const crowded = draftPlan(
    [
      unit({ unit: "first", file: "a.ts", formulaValue: 9, logic: 5 }),
      unit({ unit: "second", file: "b.ts", formulaValue: 8.5, logic: 5 }),
    ],
    "deep",
  );
  assert.equal(crowded.slots[0].type, "change");
  assert.equal(crowded.slots[1].type, "explain");
  assert.ok(crowded.estimatedSeconds <= 300);

  const standard = draftPlan([unit({ unit: "big", formulaValue: 20, logic: 8 })], "standard");
  assert.equal(standard.slots[0].type, "explain");
});

test("deep fills 300 seconds by stepping down the ladder", () => {
  const plan = draftPlan(
    [
      unit({ unit: "c1", file: "a.ts", formulaValue: 10, logic: 4 }),
      unit({ unit: "c2", file: "b.ts", formulaValue: 6, logic: 3 }),
      unit({ unit: "c3", file: "c.ts", formulaValue: 3, logic: 2, branches: 2 }),
    ],
    "deep",
  );
  assert.deepEqual(
    plan.slots.map((slot) => slot.type),
    ["change", "explain", "ordering"],
  );
  assert.equal(plan.estimatedSeconds, 300);
  assert.equal(plan.coverage, 1);
  assert.equal(plan.sessions, 1);
});

test("a logic unit still receives a question when the value is small", () => {
  const quick = draftPlan([unit({ unit: "tiny", formulaValue: 0.4, logic: 1 })], "quick");
  assert.equal(quick.slots.length, 1);
  assert.equal(quick.slots[0].type, "multiple_choice");
  assert.equal(quick.slots[0].estimatedSeconds, 20);
  assert.ok(quick.estimatedSeconds <= 120);
  assert.equal(quick.totalValue, 0.4);
  assert.equal(quick.coverage, 1);

  const standard = draftPlan([unit({ unit: "normal", formulaValue: 5, logic: 3, branches: 1 })], "standard");
  assert.ok(standard.slots.length >= 1);
  assert.ok(standard.estimatedSeconds <= 300);
});

test("type thresholds and ordering structure choose the richest fit", () => {
  assert.equal(draftPlan([unit({ unit: "e", formulaValue: 4, logic: 1 })], "standard").slots[0].type, "explain");
  assert.equal(draftPlan([unit({ unit: "p", formulaValue: 3.9, logic: 1 })], "standard").slots[0].type, "predict");
  assert.equal(draftPlan([unit({ unit: "m", formulaValue: 1.9, logic: 1 })], "standard").slots[0].type, "multiple_choice");
  assert.equal(
    draftPlan([unit({ unit: "ord", formulaValue: 1.5, logic: 1, branches: 1, loops: 1 })], "quick").slots[0].type,
    "ordering",
  );
  assert.equal(
    draftPlan([unit({ unit: "calls", formulaValue: 1.5, logic: 1, calls: ["a", "b"] })], "quick").slots[0].type,
    "ordering",
  );
  assert.equal(
    draftPlan([unit({ unit: "plain", formulaValue: 1.5, logic: 1, branches: 1, calls: ["only"] })], "quick").slots[0]
      .type,
    "multiple_choice",
  );
});

test("coverage is capped by formula value and rounded", () => {
  const wide = draftPlan([unit({ unit: "wide", formulaValue: 10, logic: 4 })], "standard");
  assert.equal(wide.slots[0].type, "explain");
  assert.equal(wide.coverage, 0.7);
  assert.equal(wide.totalValue, 10);

  const rounded = draftPlan([unit({ unit: "odd", formulaValue: 9, logic: 4 })], "standard");
  assert.equal(rounded.coverage, 0.78);

  const summed = draftPlan(
    [
      unit({ unit: "a", file: "a.ts", formulaValue: 0.1, logic: 1 }),
      unit({ unit: "b", file: "b.ts", formulaValue: 0.2, logic: 1 }),
    ],
    "quick",
  );
  assert.equal(summed.totalValue, 0.3);
  assert.equal(summed.coverage, 1);
});

test("units are ordered by value, then file, then name", () => {
  const plan = draftPlan(
    [
      unit({ unit: "zeta", file: "a.ts", formulaValue: 3, logic: 1 }),
      unit({ unit: "early", file: "z.ts", formulaValue: 5, logic: 1 }),
      unit({ unit: "alpha", file: "a.ts", formulaValue: 3, logic: 1 }),
    ],
    "standard",
  );
  assert.deepEqual(
    plan.slots.map((slot) => slot.unit),
    ["early", "alpha", "zeta"],
  );
});

test("key idea uses the trimmed signature, else the unit name", () => {
  const long = draftPlan(
    [unit({ unit: "long", signature: `  ${"x".repeat(150)}  `, formulaValue: 2, logic: 1 })],
    "quick",
  );
  assert.equal(long.slots[0].keyIdea.length, 120);
  assert.equal(long.slots[0].keyIdea, "x".repeat(120));
  assert.equal(long.slots[0].concept, "control-flow");

  const blank = draftPlan([unit({ unit: "noname", signature: "   ", formulaValue: 2, logic: 1 })], "quick");
  assert.equal(blank.slots[0].keyIdea, "noname");
});

test("the same file and unit are not questioned twice", () => {
  const plan = draftPlan(
    [
      unit({ unit: "dup", file: "a.ts", formulaValue: 6, logic: 2 }),
      unit({ unit: "dup", file: "a.ts", formulaValue: 5, logic: 2 }),
    ],
    "standard",
  );
  assert.equal(plan.slots.length, 1);
  assert.equal(plan.slots[0].unit, "dup");
});

test("importance is clamped to a half or double multiplier", () => {
  const units = [unit({ unit: "parse", formulaValue: 4, logic: 3 })];
  const up = applyAdjustment(units, "standard", { units: [{ unit: "parse", importance: 10 }] });
  assert.equal(up.accepted, true);
  assert.equal(up.units[0].formulaValue, 8);
  assert.ok(up.units[0].formulaValue <= 4 * 2);

  const down = applyAdjustment(units, "standard", { units: [{ unit: "parse", importance: 0.1 }] });
  assert.equal(down.accepted, true);
  assert.equal(down.units[0].formulaValue, 2);
  assert.equal(units[0].formulaValue, 4);

  const ignored = applyAdjustment(units, "standard", {
    units: [
      { unit: "missing", importance: 2 },
      { unit: "parse", importance: Number.POSITIVE_INFINITY },
    ],
  });
  assert.equal(ignored.accepted, true);
  assert.equal(ignored.units[0].formulaValue, 4);
});

test("a slot count past the allowed band is rejected", () => {
  const units = [unit({ unit: "only", file: "src/only.ts", formulaValue: 5, logic: 2 })];
  const skipped = [1, 2, 3, 4, 5].map((index) => ({ file: `skip${index}.ts`, flag: "template" }));
  const result = applyAdjustment(
    units,
    "standard",
    { unskip: skipped.map((entry) => entry.file) },
    { skipped },
  );
  assert.equal(result.accepted, false);
  assert.strictEqual(result.units, units);
  assert.equal(result.units.length, 1);
  assert.equal(result.units[0].formulaValue, 5);
  assert.deepEqual(result.plan, draftPlan(units, "standard"));
  assert.equal(result.plan.slots.length, 1);
});

test("one unskip on a single-slot plan is inside the band", () => {
  const units = [unit({ unit: "only", file: "src/only.ts", formulaValue: 5, logic: 2 })];
  const result = applyAdjustment(
    units,
    "standard",
    { unskip: ["templates/page.html"] },
    { skipped: [{ file: "templates/page.html", flag: "template with if-tags" }] },
  );
  assert.equal(result.accepted, true);
  assert.equal(result.units.length, 2);
  const added = result.units[1];
  assert.equal(added.unit, "page.html");
  assert.equal(added.file, "templates/page.html");
  assert.equal(added.signature, "template with if-tags");
  assert.equal(added.language, "");
  assert.equal(added.kind, "function");
  assert.equal(added.formulaValue, 0.5);
  assert.equal(added.logic, 1);
  assert.equal(added.mastery, 0.5);
  assert.equal(added.aiShare, 1);
  const slot = result.plan.slots.find((entry) => entry.unit === "page.html");
  assert.ok(slot);
  assert.equal(slot?.file, "templates/page.html");
  assert.equal(slot?.type, "multiple_choice");
  assert.equal(slot?.keyIdea, "template with if-tags");
  assert.equal(result.plan.slots.length, 2);
});

test("unskip ignores files that were not skipped and files that already have a unit", () => {
  const units = [unit({ unit: "page.html", file: "templates/page.html", formulaValue: 3, logic: 1 })];
  const result = applyAdjustment(
    units,
    "standard",
    { unskip: ["not-skipped.ts", "templates/page.html", "src/only.ts"] },
    { skipped: [{ file: "templates/page.html", flag: "template" }, { file: "other.ts", flag: "config" }] },
  );
  assert.equal(result.accepted, true);
  assert.equal(result.units.length, 1);
  assert.equal(result.units[0].formulaValue, 3);
  assert.ok(result.plan.slots.every((slot) => slot.file !== "not-skipped.ts"));
  assert.ok(result.plan.slots.every((slot) => slot.file !== "src/only.ts"));
});

test("deep keeps a question on a logic unit when importance is halved", () => {
  const units = [unit({ unit: "core", formulaValue: 8, logic: 4, branches: 2, riskTags: ["recursion"] })];
  const result = applyAdjustment(units, "deep", {
    units: [{ unit: "core", importance: 0.5, concepts: ["ownership"], keyIdea: "who frees the buffer" }],
  });
  assert.equal(result.accepted, true);
  assert.equal(result.units[0].formulaValue, 4);
  assert.equal(units[0].formulaValue, 8);
  assert.equal(result.plan.slots.length, 1);
  assert.equal(result.plan.slots[0].unit, "core");
  assert.equal(result.plan.slots[0].type, "explain");
  assert.equal(result.plan.slots[0].concept, "ownership");
  assert.equal(result.plan.slots[0].keyIdea, "who frees the buffer");
  assert.ok(result.plan.estimatedSeconds <= 300);
});

test("deep rejects a merge that drops a slotted logic unit", () => {
  const units = [
    unit({ unit: "a", file: "a.ts", formulaValue: 6, logic: 2 }),
    unit({ unit: "b", file: "b.ts", formulaValue: 6, logic: 2 }),
  ];
  const result = applyAdjustment(units, "deep", { merge: [["a", "b"]] });
  assert.equal(result.accepted, false);
  assert.strictEqual(result.units, units);
  assert.equal(result.plan.slots.length, 2);
});

test("a merge on standard shares one slot and caps covered value by its points", () => {
  const units = [
    unit({ unit: "a", file: "a.ts", formulaValue: 5, logic: 2, branches: 2 }),
    unit({ unit: "b", file: "b.ts", formulaValue: 5, logic: 2, branches: 2 }),
  ];
  const result = applyAdjustment(units, "standard", { merge: [["a", "b"]] });
  assert.equal(result.accepted, true);
  assert.equal(result.plan.slots.length, 1);
  assert.equal(result.plan.slots[0].unit, "a");
  assert.equal(result.plan.slots[0].type, "explain");
  assert.equal(result.plan.totalValue, 10);
  assert.equal(result.plan.coverage, 0.7);
});

test("an empty deep adjustment stays accepted when the budget cannot reach every unit", () => {
  const units = [0, 1, 2, 3].map((index) =>
    unit({
      unit: `u${index}`,
      file: `u${index}.ts`,
      formulaValue: 8,
      logic: 2,
    }),
  );
  const result = applyAdjustment(units, "deep", {});
  assert.equal(result.accepted, true);
  assert.ok(result.plan.slots.length < units.length);
  assert.ok(result.plan.estimatedSeconds <= 300);
  assert.deepEqual(result.plan, draftPlan(units, "deep"));
});

test("invalid adjustment shapes do not throw and keep the original plan", () => {
  const units = [unit({ unit: "only", formulaValue: 4, logic: 1, branches: 2 })];
  const presets: CheckPreset[] = ["quick", "standard", "deep"];
  for (const preset of presets) {
    const missing = applyAdjustment(units, preset, null as unknown as { units: [] });
    assert.equal(missing.accepted, true);
    assert.deepEqual(missing.plan, draftPlan(units, preset));
    assert.strictEqual(missing.units, units);
  }
  const badUnits = applyAdjustment(null as unknown as UnitFact[], "quick", { units: [{ unit: "x", importance: 10 }] });
  assert.equal(badUnits.accepted, true);
  assert.equal(badUnits.units.length, 0);
  assert.equal(badUnits.plan.slots.length, 0);
  assert.equal(badUnits.plan.sessions, 1);
});
