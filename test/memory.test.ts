import assert from "node:assert/strict";
import test from "node:test";
import { discountJudgeScore, nextElo, nextMastery, DEFAULT_BKT, MCQ_GUESS } from "../src/memory/bkt";
import { isDue, newCard, retrievability, reviewCard } from "../src/memory/scheduler";
import { chunkSource, extractSymbols } from "../src/memory/symbols";
import { gradeOrdering } from "../src/decision";
import { buildProjectMap } from "../src/memory/projectMap";
import { fileUnderstanding } from "../src/memory/understanding";
import { cosine, embed } from "../src/memory/vectors";
import type { GeneratedQuestion } from "../src/types";

test("a correct answer raises BKT mastery and a later miss does not wipe it", () => {
  let mastery = DEFAULT_BKT.prior;
  mastery = nextMastery(mastery, 1, { ...DEFAULT_BKT, guess: MCQ_GUESS });
  const afterCorrect = mastery;
  assert.ok(afterCorrect > DEFAULT_BKT.prior);
  mastery = nextMastery(mastery, 1, { ...DEFAULT_BKT, guess: MCQ_GUESS });
  mastery = nextMastery(mastery, 1, { ...DEFAULT_BKT, guess: MCQ_GUESS });
  const high = mastery;
  const afterSlip = nextMastery(high, 0, { ...DEFAULT_BKT, guess: MCQ_GUESS });
  assert.ok(afterSlip < high);
  assert.ok(afterSlip > afterCorrect);
});

test("free-response pass is discounted below 1", () => {
  const score = discountJudgeScore(true);
  assert.ok(score < 1);
  assert.ok(score > 0.5);
});

test("elo moves toward the score", () => {
  const up = nextElo(1000, 1);
  const down = nextElo(1000, 0);
  assert.ok(up > 1000);
  assert.ok(down < 1000);
});

test("a pass lengthens the recall card and a fail makes it due sooner", () => {
  const now = Date.UTC(2026, 10, 5);
  const passed = reviewCard(newCard("recursion", now), 1, now);
  const failed = reviewCard(passed, 0, now + 86_400_000);
  assert.ok(passed.intervalDays >= 1);
  assert.equal(failed.repetitions, 0);
  assert.equal(failed.intervalDays, 1);
  assert.ok(isDue(failed, failed.dueAt));
  assert.ok(retrievability(passed, now) > 0.9);
});

test("symbol extraction finds a function and chunking keeps it", () => {
  const source = "export function add(a: number, b: number) {\n  return a + b;\n}\n";
  const symbols = extractSymbols("src/add.ts", source);
  assert.ok(symbols.some((symbol) => symbol.name === "add"));
  const chunks = chunkSource("src/add.ts", source);
  assert.ok(chunks.some((chunk) => chunk.text.includes("return a + b")));
});

test("ordering score is 1 for the right order and partial otherwise", () => {
  const question: GeneratedQuestion = {
    kind: "ordering",
    question: "Order the steps",
    referenceAnswer: "a then b then c",
    criteria: [],
    items: ["a", "b", "c"],
    correctOrder: [0, 1, 2],
    conceptTags: [],
  };
  assert.equal(gradeOrdering(question, [0, 1, 2]), 1);
  assert.ok(gradeOrdering(question, [0, 2, 1]) < 1);
  assert.ok(gradeOrdering(question, [0, 2, 1]) > 0);
});

test("project map marks templates as skipped and app code as core", () => {
  const mapped = buildProjectMap([
    { path: "app.py", text: "from routes.tasks import create_task\ndef main():\n  if True:\n    create_task()\n" },
    { path: "routes/tasks.py", text: "def create_task():\n  if not title:\n    return\n" },
    { path: "templates/index.html", text: "<html></html>" },
  ]);
  assert.equal(mapped.find((file) => file.path === "templates/index.html")?.core, false);
  assert.equal(mapped.find((file) => file.path === "app.py")?.core, true);
});

test("file understanding decays when recall lapses", () => {
  const now = Date.now();
  const rows = fileUnderstanding(
    [{ path: "app.py", concepts: ["routing"], passed: true, aiWritten: true, core: true, updatedAt: now }],
    [{ concept: "routing", mastery: 0.9, elo: 1200, attempts: 3, lastSeen: now }],
    [{
      concept: "routing",
      ease: 2.5,
      intervalDays: 1,
      repetitions: 2,
      dueAt: now,
      stability: 1,
      difficulty: 5,
      lastReview: now - 10 * 24 * 60 * 60 * 1000,
    }],
    now,
  );
  assert.equal(rows[0]?.status === "understood", false);
});

test("similar code embeds closer than unrelated text", () => {
  const code = embed("function add(a, b) { return a + b; }");
  const near = embed("function sum(x, y) { return x + y; }");
  const far = embed("the weather is rain and clouds");
  assert.ok(cosine(code, near) > cosine(code, far));
});
