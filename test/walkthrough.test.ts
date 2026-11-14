/**
 * Walkthrough logic (src/walkthrough.ts) under node:test with a fake `vscode`
 * module and an in-process LLM mock. No editor, no network, no port binding.
 *
 * Tests marked { todo: "BUG-..." } assert the behavior the README promises;
 * they currently fail and are reported as TODO, not as suite failures.
 * See test-reports/claude-code-and-walkthrough.md for each BUG id.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

const req = createRequire(__filename);
req("./walkthrough/register.cjs");
const vscode = req("./walkthrough/fake-vscode.cjs");
const llm = req("./walkthrough/mock-llm.cjs");
llm.install();
// eslint-disable-next-line @typescript-eslint/no-var-requires
const wt = req("../src/walkthrough.ts") as typeof import("../src/walkthrough");

const fake = vscode.__fake;
const WALK_KEY = "comprehensionGuard.walkthrough";
const HOUR = 60 * 60 * 1000;

type Saved = {
  project: string;
  files: { path: string; snippet: string; core: boolean }[];
  session: number;
  snoozeUntil?: number;
};

const tempDirs: string[] = [];
after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeContext() {
  const store = new Map<string, unknown>();
  const storageDir = mkdtempSync(path.join(tmpdir(), "cg-wt-"));
  tempDirs.push(storageDir);
  return {
    store,
    subscriptions: [],
    globalStorageUri: { fsPath: storageDir },
    secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
    globalState: {
      get: (key: string, fallback?: unknown) => (store.has(key) ? store.get(key) : fallback),
      update: async (key: string, value: unknown) => {
        if (value === undefined) {
          store.delete(key);
        } else {
          store.set(key, JSON.parse(JSON.stringify(value)));
        }
      },
      keys: () => [...store.keys()],
      setKeysForSync() {},
    },
  } as unknown as import("vscode").ExtensionContext & { store: Map<string, unknown> };
}

function edit(filePath: string, body = "") {
  return {
    agent: "claude-code",
    filePath,
    hunks: [],
    snippet:
      `function ${path.basename(filePath).replace(/\W/g, "_")}(x) {\n  if (x) {\n    return x + 1;\n  }\n  return 0;\n}\n` + body,
  };
}

function answer(correct: boolean) {
  return (msg: { kind: string; options?: string[]; items?: string[] }) => {
    if (msg.kind === "multiple-choice") {
      const options = msg.options ?? [];
      const right = options.findIndex(
        (option) => /branch/.test(option) && /not recursive/.test(option) && !/^no branches/.test(option),
      );
      const index = right >= 0 ? right : 0;
      const wrong = options.length > 1 ? (index + 1) % options.length : 0;
      return { type: "submit", selectedIndex: correct ? index : wrong };
    }
    if (msg.kind === "ordering") {
      const count = msg.items?.length ?? 0;
      const right = count > 0 ? [...Array(count).keys()] : [1, 0, 2];
      return { type: "submit", order: correct ? right : [...right].reverse() };
    }
    return { type: "submit", answer: correct ? "GOOD it adds one when x is truthy" : "no idea what this does" };
  };
}

function saved(ctx: { store: Map<string, unknown> }): Saved | undefined {
  return ctx.store.get(WALK_KEY) as Saved | undefined;
}

function filesInPrompts(): string[][] {
  // Each session opens one panel and asks one local question per file in the group.
  return (fake.panels as { posted: { type: string; questionText?: string }[] }[])
    .map((panel) => {
      const names: string[] = [];
      for (const msg of panel.posted) {
        if (msg.type !== "showQuestion" || !msg.questionText) {
          continue;
        }
        const match = msg.questionText.match(/\b([A-Za-z0-9_]+) in /);
        if (match) {
          names.push(match[1]);
        }
      }
      return names;
    })
    .filter((names) => names.length > 0);
}

beforeEach(() => {
  fake.reset();
  fake.config = { provider: "ollama", model: "mock" };
  llm.reset();
});

test("Start runs session 1 with a local question and advances on pass", async () => {
  const ctx = makeContext();
  fake.onInfo = (_m: string, items: string[]) => (items.includes("Start session 1") ? "Start session 1" : undefined);
  fake.onQuestion = answer(true);
  await wt.offerWalkthrough(ctx, [edit("/ws/a.js"), edit("/ws/b.js"), edit("/ws/c.js")]);
  assert.match(fake.infoMessages[0].message, /demo-project: 3 files changed/);
  assert.deepEqual(fake.infoMessages[0].items, ["Start session 1", "Later today", "Snooze"]);
  assert.equal(fake.panels.length, 1, "one quiz panel per session");
  assert.deepEqual(
    fake.panels[0].posted.filter((m: { type: string }) => m.type === "showQuestion").map((m: { kind: string }) => m.kind),
    ["multiple-choice"],
  );
  assert.equal((llm.calls as unknown[]).length, 0, "the walkthrough question is local");
  assert.equal(saved(ctx)?.session, 1);
  assert.equal(saved(ctx)?.snoozeUntil, undefined);
});

test("Later today snoozes 8h, Snooze and dismissing the toast snooze 24h", async () => {
  for (const [choice, hours] of [["Later today", 8], ["Snooze", 24], [undefined, 24]] as const) {
    const ctx = makeContext();
    fake.reset();
    fake.config = { provider: "ollama" };
    fake.onInfo = () => choice;
    const before = Date.now();
    await wt.offerWalkthrough(ctx, [edit("/ws/a.js"), edit("/ws/b.js")]);
    const s = saved(ctx)!;
    assert.equal(s.session, 0);
    assert.ok(Math.abs(s.snoozeUntil! - (before + hours * HOUR)) < 5000, String(choice));
    assert.equal(fake.panels.length, 0, "no quiz while snoozed");
  }
});

test("resume on activation: nothing while snoozed, offers session after snooze expiry, Start runs it", async () => {
  const ctx = makeContext();
  fake.onInfo = () => "Later today";
  await wt.offerWalkthrough(ctx, [edit("/ws/a.js"), edit("/ws/b.js")]);
  fake.infoMessages = [];
  await wt.resumeWalkthrough(ctx);
  assert.equal(fake.infoMessages.length, 0, "still snoozed");

  const realNow = Date.now;
  Date.now = () => realNow() + 9 * HOUR;
  try {
    fake.onInfo = (m: string) => (m.includes("is ready") ? "Start" : undefined);
    fake.onQuestion = answer(true);
    await wt.resumeWalkthrough(ctx);
    assert.match(fake.infoMessages[0].message, /walkthrough session 1 is ready/);
    assert.equal(fake.panels.length, 1);
    assert.equal(saved(ctx)?.session, 1);
  } finally {
    Date.now = realNow;
  }
});

test("resume 'Later' leaves state unchanged and offers again next activation", async () => {
  const ctx = makeContext();
  await ctx.globalState.update(WALK_KEY, { project: "p", files: [{ path: "/ws/a.js", snippet: "function a(){ if(1){} }", core: true, complexity: 3, centrality: 0 }], session: 0 });
  fake.onInfo = () => "Later";
  await wt.resumeWalkthrough(ctx);
  await wt.resumeWalkthrough(ctx);
  assert.equal(fake.infoMessages.length, 2);
  assert.equal(saved(ctx)?.session, 0);
});

test("closing the quiz mid-session does not advance the session", async () => {
  const ctx = makeContext();
  fake.onInfo = (_m: string, items: string[]) => (items.includes("Start session 1") ? "Start session 1" : undefined);
  fake.onQuestion = () => ({ type: "close" });
  await wt.offerWalkthrough(ctx, [edit("/ws/a.js"), edit("/ws/b.js")]);
  assert.equal(saved(ctx)?.session, 0);
  assert.equal(saved(ctx)?.snoozeUntil, undefined, "re-offered on the next activation");
});

test("BUG-W1: answering every walkthrough question wrong should not pass the session", { todo: "BUG-W1 runSession returns true unless the panel is closed" }, async () => {
  const ctx = makeContext();
  fake.onInfo = (_m: string, items: string[]) => (items.includes("Start session 1") ? "Start session 1" : undefined);
  fake.onQuestion = answer(false);
  await wt.offerWalkthrough(ctx, [edit("/ws/a.js"), edit("/ws/b.js")]);
  assert.equal(saved(ctx)?.session, 0, "a session where every answer was wrong must not advance");
});

test("observed: answering every question wrong still advances the session (documents BUG-W1)", async () => {
  const ctx = makeContext();
  fake.onInfo = (_m: string, items: string[]) => (items.includes("Start session 1") ? "Start session 1" : undefined);
  fake.onQuestion = answer(false);
  await wt.offerWalkthrough(ctx, [edit("/ws/a.js"), edit("/ws/b.js")]);
  assert.equal(saved(ctx)?.session, 1);
});

test("a local question still opens when the model is set to fail, and closing it does not advance", async () => {
  const ctx = makeContext();
  llm.setFailGenerate(true);
  fake.onInfo = (_m: string, items: string[]) => (items.includes("Start session 1") ? "Start session 1" : undefined);
  await wt.offerWalkthrough(ctx, [edit("/ws/a.js"), edit("/ws/b.js")]);
  assert.equal(fake.panels.length, 1);
  assert.equal(saved(ctx)?.session, 0);
  assert.equal((llm.calls as unknown[]).length, 0);
});

test("group size: low or no mastery gives 1 file per session, mastery >= 0.75 gives 2", async () => {
  // No mastery, and wrong answers keep it low: 3 files -> 3 sessions of 1.
  const ctx = makeContext();
  fake.onInfo = (m: string, items: string[]) =>
    items.includes("Start session 1") ? "Start session 1" : m.includes("is ready") ? "Start" : undefined;
  fake.onQuestion = answer(false);
  await wt.offerWalkthrough(ctx, [edit("/ws/a.js"), edit("/ws/b.js"), edit("/ws/c.js")]);
  await wt.resumeWalkthrough(ctx);
  await wt.resumeWalkthrough(ctx);
  assert.deepEqual(filesInPrompts(), [["a_js"], ["b_js"], ["c_js"]]);
  assert.equal(saved(ctx), undefined, "finished");
  assert.ok(fake.infoMessages.some((m: { message: string }) => /walkthrough finished/.test(m.message)));

  // High mastery: 3 files -> 2 sessions (2 + 1).
  llm.reset();
  fake.infoMessages = [];
  fake.panels = [];
  fake.onQuestion = answer(true);
  const ctx2 = makeContext();
  await ctx2.globalState.update("comprehensionGuard.conceptMastery", [
    { concept: "control-flow", mastery: 0.9, elo: 1200, attempts: 5, lastSeen: Date.now() },
  ]);
  await wt.offerWalkthrough(ctx2, [edit("/ws/a.js"), edit("/ws/b.js"), edit("/ws/c.js")]);
  await wt.resumeWalkthrough(ctx2);
  assert.deepEqual(filesInPrompts(), [["a_js", "b_js"], ["c_js"]]);
  assert.equal(saved(ctx2), undefined);
});

test("BUG-W3: more than 6 sessions of files - files after the 6th group are never walked through", { todo: "BUG-W3 sessionsFor() slices to 6 groups" }, async () => {
  const ctx = makeContext();
  fake.onInfo = (m: string, items: string[]) =>
    items.includes("Start session 1") ? "Start session 1" : m.includes("is ready") ? "Start" : undefined;
  fake.onQuestion = answer(false); // keeps group size at 1
  const files = ["a", "b", "c", "d", "e", "f", "g", "h"].map((n) => edit(`/ws/${n}.js`));
  await wt.offerWalkthrough(ctx, files);
  for (let i = 0; i < 10; i++) {
    await wt.resumeWalkthrough(ctx);
  }
  const covered = filesInPrompts().flat();
  assert.ok(covered.includes("g_js") && covered.includes("h_js"), "covered: " + covered.join(","));
});

test("observed: with 7 files (the auto threshold) and mastery kept low, the 7th file is dropped (BUG-W3)", async () => {
  // Wrong answers keep mastery low (group size 1) and still advance (BUG-W1).
  const ctx = makeContext();
  fake.onInfo = (m: string, items: string[]) =>
    items.includes("Start session 1") ? "Start session 1" : m.includes("is ready") ? "Start" : undefined;
  fake.onQuestion = answer(false);
  await wt.offerWalkthrough(ctx, ["a", "b", "c", "d", "e", "f", "g"].map((n) => edit(`/ws/${n}.js`)));
  for (let i = 0; i < 10; i++) {
    await wt.resumeWalkthrough(ctx);
  }
  assert.deepEqual(filesInPrompts(), [["a_js"], ["b_js"], ["c_js"], ["d_js"], ["e_js"], ["f_js"]]);
  assert.equal(saved(ctx), undefined, "walkthrough reports finished");
  assert.ok(fake.infoMessages.some((m: { message: string }) => /walkthrough finished/.test(m.message)));
});

test("observed: with 7 files and correct answers, mastery rises mid-walkthrough and a file is skipped (BUG-W4)", async () => {
  const ctx = makeContext();
  fake.onInfo = (m: string, items: string[]) =>
    items.includes("Start session 1") ? "Start session 1" : m.includes("is ready") ? "Start" : undefined;
  fake.onQuestion = answer(true);
  await wt.offerWalkthrough(ctx, ["a", "b", "c", "d", "e", "f", "g"].map((n) => edit(`/ws/${n}.js`)));
  for (let i = 0; i < 10; i++) {
    await wt.resumeWalkthrough(ctx);
  }
  const groups = filesInPrompts();
  const covered = new Set(groups.flat());
  assert.ok(covered.has("a_js") && covered.has("b_js"), "groups: " + JSON.stringify(groups));
  assert.ok(!covered.has("c_js") && !covered.has("d_js"), "groups: " + JSON.stringify(groups));
});

test("BUG-W4: mastery rising mid-walkthrough should not skip a file", { todo: "BUG-W4 groups are recomputed from live mastery but session index is reused" }, async () => {
  // A fresh user: passing session 1 alone lifts mastery past 0.75, so group size flips 1 -> 2.
  const ctx = makeContext();
  fake.onInfo = (m: string, items: string[]) =>
    items.includes("Start session 1") ? "Start session 1" : m.includes("is ready") ? "Start" : undefined;
  fake.onQuestion = answer(true);
  await wt.offerWalkthrough(ctx, ["a", "b", "c", "d"].map((n) => edit(`/ws/${n}.js`)));
  for (let i = 0; i < 6; i++) {
    await wt.resumeWalkthrough(ctx);
  }
  const covered = filesInPrompts().flat();
  assert.deepEqual([...new Set(covered)].sort(), ["a_js", "b_js", "c_js", "d_js"], "covered: " + covered.join(","));
});

test("BUG-W5: a second large change should not overwrite a walkthrough in progress", { todo: "BUG-W5 single globalState slot" }, async () => {
  const ctx = makeContext();
  fake.onInfo = () => "Snooze";
  await wt.offerWalkthrough(ctx, [edit("/ws/a.js"), edit("/ws/b.js")]);
  await wt.offerWalkthrough(ctx, [edit("/ws/x.js"), edit("/ws/y.js")]);
  const paths = saved(ctx)!.files.map((f) => f.path);
  assert.ok(paths.includes("/ws/a.js"), "first walkthrough lost: " + paths.join(","));
});

test("collapse: duplicate paths merge, backslash and forward slash merge", async () => {
  const ctx = makeContext();
  fake.onInfo = () => "Snooze";
  await wt.offerWalkthrough(ctx, [
    edit("C:\\ws\\src\\a.js"),
    edit("C:/ws/src/a.js", "// second edit\n"),
    edit("C:\\ws\\src\\a.js", "// third edit\n"),
    edit("C:\\ws\\src\\b.js"),
  ]);
  const s = saved(ctx)!;
  assert.deepEqual(s.files.map((f) => f.path).sort(), ["C:/ws/src/a.js", "C:/ws/src/b.js"]);
  assert.match(fake.infoMessages[0].message, /2 files changed/);
  const a = s.files.find((f) => f.path.endsWith("a.js"))!;
  assert.match(a.snippet, /second edit/);
  assert.match(a.snippet, /third edit/);
});

test("BUG-W6: collapse should treat drive-letter / case variants of one Windows file as one file", { todo: "BUG-W6 collapse() only swaps slashes; it does not use normPath" }, async () => {
  const ctx = makeContext();
  fake.onInfo = () => "Snooze";
  await wt.offerWalkthrough(ctx, [edit("C:\\ws\\src\\a.js"), edit("c:\\ws\\SRC\\a.js")]);
  assert.equal(saved(ctx)!.files.length, 1);
});

test("observed: non-core files (json, md, css, html) are listed in the count but never quizzed", async () => {
  llm.setTags([]);
  const ctx = makeContext();
  fake.onInfo = (m: string, items: string[]) =>
    items.includes("Start session 1") ? "Start session 1" : m.includes("is ready") ? "Start" : undefined;
  fake.onQuestion = answer(true);
  await wt.offerWalkthrough(ctx, [
    edit("/ws/a.js"),
    { agent: "claude-code", filePath: "/ws/README.md", hunks: [], snippet: "# Big doc\n".repeat(30) },
    { agent: "claude-code", filePath: "/ws/settings.json", hunks: [], snippet: '{"a":1}\n'.repeat(30) },
  ]);
  assert.match(fake.infoMessages[0].message, /3 files changed/);
  for (let i = 0; i < 3; i++) {
    await wt.resumeWalkthrough(ctx);
  }
  assert.equal(filesInPrompts().length, 1, "only the core file got a session");
});

test("walkthrough questions are local and do not call the model", async () => {
  const ctx = makeContext();
  fake.onInfo = (_m: string, items: string[]) => (items.includes("Start session 1") ? "Start session 1" : undefined);
  fake.onQuestion = answer(true);
  await wt.offerWalkthrough(ctx, [edit("/ws/a.js"), edit("/ws/b.js")]);
  assert.equal((llm.calls as unknown[]).length, 0);
  assert.deepEqual(
    fake.panels[0].posted.filter((m: { type: string }) => m.type === "showQuestion").map((m: { kind: string }) => m.kind),
    ["multiple-choice"],
  );
});
