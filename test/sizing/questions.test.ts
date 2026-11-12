import assert from "node:assert/strict";
import test from "node:test";
import { gradeLocal, questionsFor } from "../../src/sizing/questions";
import type { DraftPlan, LocalQuestion, PlanSlot, QuestionType, UnitFact } from "../../src/sizing/types";

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
    logic: 3.5,
    risk: 1,
    formulaValue: 2,
    ...overrides,
  };
}

function slot(type: QuestionType, unit: string, file: string, concept: string): PlanSlot {
  return {
    type,
    unit,
    file,
    concept,
    keyIdea: concept,
    points: 1,
    estimatedSeconds: 20,
  };
}

function plan(slots: PlanSlot[]): DraftPlan {
  return {
    preset: "standard",
    slots,
    sessions: 1,
    estimatedSeconds: slots.length * 20,
    coverage: 1,
    totalValue: slots.length,
  };
}

function restored(question: LocalQuestion): string[] {
  assert.ok(Array.isArray(question.answer));
  return question.answer.map((index) => question.options[index] ?? "");
}

test("questionsFor returns one question per slot", () => {
  const units = [
    fact({ unit: "sum", file: "src/math.ts", branches: 2, loops: 1, recursive: false }),
    fact({
      unit: "walk",
      file: "src/tree.ts",
      startLine: 20,
      endLine: 40,
      branches: 0,
      loops: 2,
      recursive: true,
    }),
    fact({
      unit: "render",
      file: "src/view.ts",
      startLine: 1,
      endLine: 8,
      branches: 1,
      loops: 0,
      recursive: false,
    }),
    fact({
      unit: "save",
      file: "src/store.ts",
      startLine: 12,
      endLine: 30,
      branches: 3,
      loops: 0,
      recursive: true,
    }),
    fact({
      unit: "run",
      file: "src/app.ts",
      startLine: 1,
      endLine: 24,
      calls: ["parse", "validate", "save", "log"],
    }),
  ];
  const slots = [
    slot("multiple_choice", "sum", "src/math.ts", "control-flow"),
    slot("predict", "walk", "src/tree.ts", "recursion"),
    slot("explain", "render", "src/view.ts", "branches"),
    slot("change", "save", "src/store.ts", "state"),
    slot("ordering", "run", "src/app.ts", "sequence"),
  ];
  const questions = questionsFor(plan(slots), units);
  assert.equal(questions.length, slots.length);
  assert.deepEqual(
    questions.map((question) => [question.unit, question.type, question.concept]),
    [
      ["sum", "multiple_choice", "control-flow"],
      ["walk", "multiple_choice", "recursion"],
      ["render", "multiple_choice", "branches"],
      ["save", "multiple_choice", "state"],
      ["run", "ordering", "sequence"],
    ],
  );

  const sum = questions[0];
  assert.equal(sum?.prompt, "What is the control-flow shape of sum in src/math.ts?");
  assert.equal(sum?.explanation, "2 branches, 1 loop, not recursive");
  assert.equal(sum?.hint, "Count the ifs and loops in sum");
  assert.deepEqual(sum?.options.slice().sort(), [
    "2 branches, 1 loop, not recursive",
    "2 branches, 1 loop, recursive",
    "It is markup or config with no logic.",
    "no branches, 1 loop, not recursive",
  ]);

  const walk = questions[1];
  assert.equal(walk?.explanation, "0 branches, 2 loops, recursive");
  assert.ok(walk?.options.includes("several branches, 2 loops, recursive"));
  assert.ok(walk?.options.includes("0 branches, 2 loops, not recursive"));

  const render = questions[2];
  assert.equal(render?.explanation, "1 branch, 0 loops, not recursive");
  assert.ok(render?.options.includes("no branches, 0 loops, not recursive"));

  const withMissing = questionsFor(
    plan([...slots, slot("explain", "missing", "src/missing.ts", "none")]),
    units,
  );
  assert.equal(withMissing.length, slots.length);
});

test("gradeLocal accepts the correct index and rejects a wrong one", () => {
  const unit = fact({ unit: "sum", file: "src/math.ts", branches: 2, loops: 1, recursive: false });
  const questions = questionsFor(plan([slot("multiple_choice", "sum", "src/math.ts", "control-flow")]), [unit]);
  const question = questions[0];
  assert.ok(question);
  assert.equal(question.type, "multiple_choice");
  assert.equal(typeof question.answer, "number");
  assert.equal(question.options[question.answer as number], "2 branches, 1 loop, not recursive");
  assert.equal(new Set(question.options).size, 4);

  assert.equal(gradeLocal(question, { selectedIndex: question.answer as number }), true);
  const wrong = ((question.answer as number) + 1) % question.options.length;
  assert.equal(gradeLocal(question, { selectedIndex: wrong }), false);
  assert.equal(gradeLocal(question, {}), false);
  assert.equal(gradeLocal(question, { order: [0, 1, 2, 3] }), false);
});

test("ordering question grades the correct permutation", () => {
  const calls = fact({
    unit: "run",
    file: "src/app.ts",
    calls: ["parse", "validate", "save", "log"],
  });
  const steps = fact({
    unit: "boot",
    file: "src/boot.ts",
    startLine: 1,
    endLine: 8,
    calls: ["init"],
  });
  const questions = questionsFor(
    plan([
      slot("ordering", "run", "src/app.ts", "sequence"),
      slot("ordering", "boot", "src/boot.ts", "sequence"),
    ]),
    [calls, steps],
  );
  const callQuestion = questions[0];
  const stepQuestion = questions[1];
  assert.ok(callQuestion && stepQuestion);

  assert.equal(callQuestion.prompt, "In run, put these calls in the order they appear.");
  assert.equal(callQuestion.hint, "Read the function from top to bottom.");
  assert.equal(callQuestion.explanation, "parse then validate then save");
  assert.deepEqual(callQuestion.options.slice().sort(), ["parse", "save", "validate"]);
  assert.deepEqual(restored(callQuestion), ["parse", "validate", "save"]);
  assert.equal(gradeLocal(callQuestion, { order: callQuestion.answer as number[] }), true);
  const rotated = [...(callQuestion.answer as number[]).slice(1), (callQuestion.answer as number[])[0]];
  assert.equal(gradeLocal(callQuestion, { order: rotated }), false);
  assert.equal(gradeLocal(callQuestion, { order: (callQuestion.answer as number[]).slice(0, 2) }), false);
  assert.equal(gradeLocal(callQuestion, {}), false);

  assert.equal(stepQuestion.prompt, "In boot, put these steps in the order they happen.");
  assert.equal(stepQuestion.explanation, "read the inputs then take the branch then return a result");
  assert.deepEqual(restored(stepQuestion), ["read the inputs", "take the branch", "return a result"]);
  assert.equal(gradeLocal(stepQuestion, { order: stepQuestion.answer as number[] }), true);
  const wrongSteps = [...(stepQuestion.answer as number[]).slice(1), (stepQuestion.answer as number[])[0]];
  assert.equal(gradeLocal(stepQuestion, { order: wrongSteps }), false);
});

test("two calls with the same file and unit produce the same answer index", () => {
  const unit = fact({ unit: "sum", file: "src/math.ts", branches: 2, loops: 1, recursive: false });
  const slots = [
    slot("multiple_choice", "sum", "src/math.ts", "control-flow"),
    slot("explain", "sum", "src/math.ts", "control-flow"),
  ];
  const first = questionsFor(plan(slots), [unit]);
  const second = questionsFor(plan(slots), [unit]);
  assert.equal(first.length, 2);
  assert.equal(typeof first[0]?.answer, "number");
  assert.equal(first[0]?.answer, first[1]?.answer);
  assert.equal(first[0]?.answer, second[0]?.answer);
  assert.deepEqual(first[0]?.options, second[0]?.options);
  assert.deepEqual(
    first.map((question) => question.answer),
    second.map((question) => question.answer),
  );
});
