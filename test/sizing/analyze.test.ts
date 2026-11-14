import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeFile, analyzeFiles } from "../../src/sizing/analyze";

const javascript = `
function walk(n) {
  if (n > 0) {
    for (let i = 0; i < n; i++) {
      walk(i);
      helper(i);
    }
  }
}

const double = (n) => n + 1;

class Box {
  value(n) {
    if (n) {
      return helper(n);
    }
    return this.n;
  }
}
`;

test("javascript function, arrow, and class method", async () => {
  const result = await analyzeFile("walk.js", javascript);
  assert.equal(result.language, "javascript");
  assert.equal(result.skipped, null);
  assert.deepEqual(
    result.units.map((unit) => unit.unit),
    ["walk", "double", "Box", "value"],
  );

  const walk = result.units[0];
  assert.equal(walk.kind, "function");
  assert.equal(walk.branches, 1);
  assert.equal(walk.loops, 1);
  assert.deepEqual(walk.calls, ["walk", "helper"]);
  assert.equal(walk.recursive, true);
  assert.ok(walk.riskTags.includes("recursion"));
  assert.equal(walk.mastery, 0.5);
  assert.equal(walk.aiShare, 1);
  assert.ok(walk.formulaValue > 0);
  assert.equal(walk.signature, "function walk(n) {");

  const arrow = result.units[1];
  assert.equal(arrow.kind, "function");
  assert.equal(arrow.branches, 0);
  assert.equal(arrow.loops, 0);
  assert.deepEqual(arrow.calls, []);
  assert.equal(arrow.recursive, false);

  const box = result.units[2];
  assert.equal(box.kind, "class");
  assert.equal(box.branches, 0);
  assert.equal(box.loops, 0);
  assert.deepEqual(box.calls, []);

  const method = result.units[3];
  assert.equal(method.kind, "method");
  assert.equal(method.branches, 1);
  assert.deepEqual(method.calls, ["helper"]);
  assert.equal(method.recursive, false);
});

test("python def with if and for", async () => {
  const source = `
def tally(items):
    total = 0
    for item in items:
        if item:
            total = total + 1
    return total
`;
  const result = await analyzeFile("tally.py", source);
  assert.equal(result.language, "python");
  assert.equal(result.units.length, 1);
  const tally = result.units[0];
  assert.equal(tally.unit, "tally");
  assert.equal(tally.kind, "function");
  assert.equal(tally.branches, 1);
  assert.equal(tally.loops, 1);
  assert.equal(tally.recursive, false);
});

test("c function that calls malloc is tagged memory", async () => {
  const source = `
#include <stdlib.h>
int make(int n) {
  void *p = malloc(n);
  if (p) {
    return 1;
  }
  return 0;
}
`;
  const result = await analyzeFile("make.c", source);
  assert.equal(result.language, "c");
  const make = result.units.find((unit) => unit.unit === "make");
  assert.ok(make);
  assert.equal(make.kind, "function");
  assert.ok(make.branches >= 1);
  assert.ok(make.riskTags.includes("memory"));
  assert.ok(make.calls.includes("malloc"));
});

test("skipped styles, lockfiles, and html templates", async () => {
  const css = await analyzeFile("styles.css", "body { color: red; }\n");
  assert.equal(css.skipped?.file, "styles.css");
  assert.equal(css.skipped?.flag, "styles");
  assert.equal(css.units.length, 0);

  const lock = await analyzeFile("package-lock.json", "{\"lockfileVersion\": 1}\n");
  assert.equal(lock.skipped?.flag, "generated");
  assert.equal(lock.units.length, 0);

  const html = await analyzeFile("page.html", "<p>{% if user %}</p>\n");
  assert.equal(html.skipped?.flag, "template with if-tags");
  assert.equal(html.units.length, 0);
  assert.equal(html.language, null);
});

test("analyzeFiles links callers across two javascript files", async () => {
  const [a, b] = await analyzeFiles([
    { file: "a.js", source: "function foo() {\n  return 1;\n}\n" },
    { file: "b.js", source: "function bar() {\n  return foo();\n}\n" },
  ]);
  const foo = a.units.find((unit) => unit.unit === "foo");
  const bar = b.units.find((unit) => unit.unit === "bar");
  assert.ok(foo);
  assert.ok(bar);
  assert.ok(foo.callers.includes("bar"));
  assert.deepEqual(bar.calls, ["foo"]);
  assert.ok(bar.logic >= 1);
});

test("aiShare 0 forces formulaValue 0", async () => {
  const result = await analyzeFile("a.js", "function f(x) {\n  if (x) return x;\n}\n", { aiShare: 0 });
  assert.equal(result.units.length, 1);
  assert.equal(result.units[0].aiShare, 0);
  assert.equal(result.units[0].formulaValue, 0);
  assert.equal(result.units[0].logic, 0);
});

test("dense one-liner scores without an if", async () => {
  const result = await analyzeFile("pack.js", "const pack = (x) => (x << 2) ^ (x >> 1);\n");
  assert.equal(result.units.length, 1);
  const pack = result.units[0];
  assert.equal(pack.unit, "pack");
  assert.equal(pack.kind, "function");
  assert.equal(pack.branches, 0);
  assert.ok(pack.lines <= 3);
  assert.ok(pack.formulaValue > 0);
});

test("unknown extension returns no units", async () => {
  const result = await analyzeFile("notes.txt", "hello\n");
  assert.equal(result.language, null);
  assert.equal(result.skipped, null);
  assert.deepEqual(result.units, []);
});
