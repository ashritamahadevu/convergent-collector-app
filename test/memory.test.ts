import assert from "node:assert/strict";
import test from "node:test";
import { discountJudgeScore, nextElo, nextMastery, DEFAULT_BKT, MCQ_GUESS } from "../src/memory/bkt";
import { isDue, newCard, retrievability, reviewCard } from "../src/memory/scheduler";
import { chunkSource, extractSymbols } from "../src/memory/symbols";
import { cosine, embed } from "../src/memory/vectors";

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

test("similar code embeds closer than unrelated text", () => {
  const code = embed("function add(a, b) { return a + b; }");
  const near = embed("function sum(x, y) { return x + y; }");
  const far = embed("the weather is rain and clouds");
  assert.ok(cosine(code, near) > cosine(code, far));
});
