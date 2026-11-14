import assert from "node:assert/strict";
import test from "node:test";
import { InsertWindow, insertedSpans } from "../src/insertWindow";
import { rememberAcceptedSnippet, resetAcceptedSnippets, wasJustAccepted } from "../src/acceptedSnippets";

test("inserted spans account for earlier inserts in the same edit", () => {
  const spans = insertedSpans([
    { rangeOffset: 0, rangeLength: 0, text: "aaa" },
    { rangeOffset: 0, rangeLength: 0, text: "bb" },
  ]);
  assert.deepEqual(spans, [
    { start: 0, end: 3, text: "aaa" },
    { start: 3, end: 5, text: "bb" },
  ]);
});

test("small inserts add up inside the window and reset after it", () => {
  let now = 0;
  const window = new InsertWindow(500, () => now);
  assert.equal(window.add("a", "x".repeat(40)).chars, 40);
  now = 400;
  assert.equal(window.add("a", "y".repeat(40)).chars, 80);
  now = 1000;
  assert.equal(window.add("a", "z".repeat(10)).chars, 10);
});

test("a snippet that just passed is not quizzed again", () => {
  resetAcceptedSnippets();
  assert.equal(wasJustAccepted("code"), false);
  rememberAcceptedSnippet("code");
  assert.equal(wasJustAccepted("code"), true);
  resetAcceptedSnippets();
});
