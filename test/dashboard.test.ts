import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { startDashboardBackend } from "../desktop/backend/server";
import { DashboardOutbox } from "../src/dashboard/outbox";
import { isReviewEvent, localEndpoint, type ReviewEvent } from "../src/dashboard/protocol";
import { recordMastery, recordReview } from "../src/dashboard/service";
import { settings, panels, resetStub, window as vscodeWindow, Position } from "./network/vscodeStub";
import { fakeContext, MCQ_QUESTION, FREE_TEXT_QUESTION, judgeJson } from "./network/harness";
import { clearQuestionCache } from "../src/llm";
import { runComprehensionGate, runSession } from "../src/quiz";
import { getStats } from "../src/store";
import type { GeneratedQuestion } from "../src/types";

const token = "a".repeat(64);
const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
function event(outcome: ReviewEvent["outcome"] = "pass", score: number | null = 1): ReviewEvent {
  return {
    schemaVersion: 1, type: "review.recorded", eventId: randomUUID(), installationId: "test-install",
    occurredAt: Date.now(), project: { id: "project-1", name: "Example" },
    concepts: ["control-flow"], topic: "", question: "What returns?", answer: "One", feedback: "Correct.",
    misconception: "", outcome, score, source: "agent", mode: "free-text", shape: "general",
    groupId: randomUUID(), filePath: "src/app.ts", retries: 0, masteryAfter: score,
  };
}
async function fixture(t: import("node:test").TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "drawbridge-test-"));
  t.after(async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await fs.rm(directory, { recursive: true, force: true });
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    }
  });
  const databasePath = path.join(directory, "dashboard.sqlite");
  const backend = await startDashboardBackend({ databasePath, token, port: 0 });
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await backend.close(); } };
  t.after(close);
  const request = (route: string, body?: unknown, override: Record<string, string> = {}) => fetch(backend.endpoint + route, {
    method: body === undefined ? "GET" : "POST", headers: { ...headers, ...override },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { directory, databasePath, backend, close, request };
}

test("local receiver commits before acknowledgement; duplicate retry survives restart", async t => {
  const f = await fixture(t); const e = event();
  const response = await f.request("/v1/events", e);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { eventId: e.eventId });
  assert.equal((await f.request("/v1/events", e)).status, 200);
  assert.equal(f.backend.database.history().length, 1);
  const conflicting = structuredClone(e); conflicting.answer = "Different";
  assert.equal((await f.request("/v1/events", conflicting)).status, 409);
  await f.close();
  const restarted = await startDashboardBackend({ databasePath: f.databasePath, token, port: 0 });
  t.after(() => restarted.close());
  assert.deepEqual(restarted.database.history(), [e]);
});

test("receiver rejects unauthenticated, browser, malformed, oversized, unsupported, and invalid requests", async t => {
  const f = await fixture(t);
  assert.equal((await f.request("/v1/events", event(), { Authorization: "Bearer wrong" })).status, 401);
  assert.equal((await f.request("/v1/history", undefined, { Origin: "https://example.com" })).status, 403);
  assert.equal((await f.request("/v1/events", { schemaVersion: 2 })).status, 400);
  const e = event(); e.score = 6;
  assert.equal((await f.request("/v1/events", e)).status, 400);
  assert.equal((await f.request("/v1/events", { huge: "x".repeat(140000) })).status, 413);
  assert.equal((await f.request("/v1/history?limit=201")).status, 400);
  assert.equal((await f.request("/v1/growth?days=365")).status, 400);
  assert.equal((await fetch(f.backend.endpoint + "/v1/events", { method: "POST", headers, body: "{" })).status, 400);
  assert.equal(f.backend.database.history().length, 0);
});

test("growth uses raw assessment scores, excludes bypass/explanation/ungraded, and filters time", async t => {
  const f = await fixture(t);
  const entries = [event("pass", 1), event("fail", 0.4), event("bypass", null), event("explained", null), event("ungraded", null)];
  const old = event(); old.occurredAt -= 31 * 86400000;
  for (const e of [...entries, old]) await f.request("/v1/events", e);
  const data = await (await f.request("/v1/growth?days=7")).json() as any;
  assert.equal(data.completedChecks, 2); assert.equal(data.totalChecks, 5);
  assert.equal(data.bypassedChecks, 1); assert.equal(data.averageScoreOutOfFive, 3.5);
  assert.equal(data.points.length, 2);
  assert.equal((await (await f.request("/v1/history?limit=2&offset=1")).json() as any).checks.length, 2);
});

test("connection status comes from authenticated heartbeats", async t => {
  const f = await fixture(t);
  assert.equal((await (await f.request("/v1/status")).json() as any).extensionConnected, false);
  await f.request("/v1/heartbeat", {});
  assert.equal((await (await f.request("/v1/status")).json() as any).extensionConnected, true);
});

test("outbox retains data offline, reloads after restart, and drains concurrent flushes exactly once", async t => {
  const f = await fixture(t);
  const directory = path.join(f.directory, "outbox");
  const box = new DashboardOutbox(directory);
  const a = event(), b = event();
  await Promise.all([box.enqueue(a), box.enqueue(b)]);
  await box.flush(async () => ({ endpoint: "http://127.0.0.1:1", token }));
  assert.equal((await box.pending()).length, 2);
  const restarted = new DashboardOutbox(directory);
  const connection = async () => ({ endpoint: f.backend.endpoint, token });
  await Promise.all([restarted.flush(connection), restarted.flush(connection)]);
  assert.equal((await restarted.pending()).length, 0);
  assert.equal(f.backend.database.history().length, 2);
  assert.ok(restarted.lastSyncedAt);
});

test("disabled sync keeps queued records without sending", async t => {
  const f = await fixture(t); const box = new DashboardOutbox(path.join(f.directory, "outbox"));
  await box.enqueue(event()); await box.flush(async () => null);
  assert.equal((await box.pending()).length, 1); assert.equal(f.backend.database.history().length, 0);
});

test("bad acknowledgements are quarantined while later events sync; hung responses stay pending", async t => {
  const f = await fixture(t); const box = new DashboardOutbox(path.join(f.directory, "outbox"));
  const bad = event(); bad.eventId = "aaa-bad";
  const good = event(); good.eventId = "zzz-good";
  await box.enqueue(bad); await box.enqueue(good);
  let hanging = false;
  const mock = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    if (hanging) return;
    const data = JSON.parse(body);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v1/heartbeat") { res.end("{}"); return; }
    if (data.eventId === bad.eventId) { res.end(JSON.stringify({ eventId: "wrong" })); return; }
    f.backend.database.insert(data); res.end(JSON.stringify({ eventId: data.eventId }));
  });
  await new Promise<void>(resolve => mock.listen(0, "127.0.0.1", resolve));
  t.after(() => { mock.closeAllConnections(); mock.close(); });
  const endpoint = "http://127.0.0.1:" + (mock.address() as import("node:net").AddressInfo).port;
  await box.flush(async () => ({ endpoint, token }));
  assert.equal((await box.pending()).length, 0);
  const rejected = await box.quarantined(); assert.equal(rejected.length, 1);
  assert.match(rejected[0].file, /aaa-bad/); assert.match(rejected[0].reason, /acknowledge/);
  assert.deepEqual(f.backend.database.history(), [good]);
  await box.enqueue(event());
  hanging = true;
  const start = Date.now(); await box.flush(async () => ({ endpoint, token }));
  assert.ok(Date.now() - start < 4500); assert.equal((await box.pending()).length, 1);
});

test("corrupt JSON, invalid schemas, and HTTP 409 never block later events and remain inspectable after restart", async t => {
  const f = await fixture(t); const directory = path.join(f.directory, "outbox");
  const box = new DashboardOutbox(directory);
  const original = event(); original.eventId = "ccc-conflict";
  f.backend.database.insert(original);
  await box.enqueue({ ...original, answer: "different answer" });
  await fs.writeFile(path.join(directory, "aaa-corrupt.json"), "{broken");
  await fs.writeFile(path.join(directory, "bbb-schema.json"), JSON.stringify({ schemaVersion: 99 }));
  const good = event(); good.eventId = "zzz-valid"; await box.enqueue(good);
  const connect = async () => ({ endpoint: f.backend.endpoint, token });
  await box.flush(connect);
  assert.equal((await box.pending()).length, 0); assert.equal(f.backend.database.history().length, 2);
  const restarted = new DashboardOutbox(directory); const rejected = await restarted.quarantined();
  assert.equal(rejected.length, 3); assert.ok(rejected.some(r => r.reason.includes("409")));
  assert.ok(rejected.some(r => r.reason.includes("Invalid queued JSON")));
  assert.ok(rejected.some(r => r.reason.includes("Invalid queued dashboard event")));
  for (const r of rejected) assert.ok((await fs.readFile(path.join(directory, "quarantine", r.file), "utf8")).length);
  await restarted.flush(connect); assert.equal(f.backend.database.history().length, 2);
  assert.equal((await restarted.quarantined()).length, 3);
});

test("authentication errors retain events for re-pairing instead of quarantining them", async t => {
  const f = await fixture(t); const box = new DashboardOutbox(path.join(f.directory, "outbox"));
  await box.enqueue(event()); await box.flush(async () => ({ endpoint: f.backend.endpoint, token: "wrong" }));
  assert.equal((await box.pending()).length, 1); assert.equal((await box.quarantined()).length, 0);
  await box.flush(async () => ({ endpoint: f.backend.endpoint, token }));
  assert.equal((await box.pending()).length, 0); assert.equal(f.backend.database.history().length, 1);
});

test("protocol refuses external endpoints, absolute paths, and scores on bypasses", () => {
  for (const url of ["https://example.com", "http://localhost:80", "http://127.0.0.1/path", "http://user:pass@127.0.0.1"]) assert.throws(() => localEndpoint(url));
  assert.equal(isReviewEvent(event("bypass", 1)), false);
  const e = event(); e.filePath = "/Users/example/project/file.ts"; assert.equal(isReviewEvent(e), false);
  e.filePath = "../outside.ts"; assert.equal(isReviewEvent(e), false);
});

test("extension capture is opt-in and persists question details without source code or absolute paths", async t => {
  const f = await fixture(t); const store = new Map<string, unknown>();
  const storage = path.join(f.directory, "extension");
  const context = { globalStorageUri: { fsPath: storage, toString: () => storage },
    globalState: { get: (k: string) => store.get(k), update: async (k: string, v: unknown) => { store.set(k, v); } },
    secrets: { get: async () => undefined } } as any;
  const e = event();
  const input = {
    eventId: e.eventId, timestamp: e.occurredAt, concepts: e.concepts, question: e.question, answer: e.answer,
    feedback: e.feedback, misconception: "", outcome: e.outcome, score: e.score, source: e.source, mode: e.mode,
    filePath: "/private/project/app.ts", retries: 0,
  };
  settings.set("comprehensionGuard.desktopSyncEnabled", false);
  await recordReview(context, input);
  await assert.rejects(fs.readdir(storage));
  settings.set("comprehensionGuard.desktopSyncEnabled", true);
  t.after(() => settings.delete("comprehensionGuard.desktopSyncEnabled"));
  await recordReview(context, input);
  const files = await fs.readdir(path.join(storage, "dashboard-outbox"));
  const saved = JSON.parse(await fs.readFile(path.join(storage, "dashboard-outbox", files[0]), "utf8"));
  assert.equal(saved.filePath, null); assert.equal(saved.question, e.question);
  assert.equal(saved.project.name, "Unassigned"); assert.equal(saved.score, 1);
});

test("ordinary quiz captures scores, walkthrough bypass is unscored, and new questions get distinct IDs", async t => {
  const f = await fixture(t); resetStub();
  settings.set("comprehensionGuard.desktopSyncEnabled", true);
  settings.set("comprehensionGuard.provider", "ollama");
  settings.set("comprehensionGuard.gradingMode", "multiple-choice");
  const context = Object.assign(fakeContext(), { globalStorageUri: { fsPath: path.join(f.directory, "extension"), toString: () => "test-storage" } });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => String(input).startsWith("http://127.0.0.1:11434")
    ? new Response(JSON.stringify({ message: { content: JSON.stringify(MCQ_QUESTION) } }), { headers: { "Content-Type": "application/json" } })
    : realFetch(input, init);
  t.after(() => { globalThis.fetch = realFetch; resetStub(); });
  const gate = runComprehensionGate("function total() { return 6; }", context as never, "javascript", { source: "agent" });
  const wait = async (predicate: () => boolean) => {
    const start = Date.now(); while (!predicate()) { if (Date.now() - start > 2000) throw new Error("Quiz did not open"); await new Promise(r => setTimeout(r, 5)); }
  };
  await wait(() => panels.length === 1); panels[0].fromWebview({ type: "ready" });
  await wait(() => panels[0].questions().length === 1);
  panels[0].fromWebview({ type: "submit", selectedIndex: 1 });
  assert.equal(await gate, true);
  const session = runSession(context as never, { snippet: "return 6;", questions: [MCQ_QUESTION as GeneratedQuestion] });
  await wait(() => panels.length === 2); panels[1].fromWebview({ type: "ready" });
  await wait(() => panels[1].questions().length === 1); panels[1].fromWebview({ type: "bypass" });
  assert.equal(await session, true);
  const box = new DashboardOutbox(path.join(context.globalStorageUri.fsPath, "dashboard-outbox"));
  const reviewCount = async () => {
    let count = 0;
    for (const name of await box.pending()) {
      const saved = JSON.parse(await fs.readFile(path.join(box.directory, name), "utf8")) as { type?: string };
      if (saved.type === "review.recorded") count += 1;
    }
    return count;
  };
  const followupGate = runComprehensionGate("function total() { return 6; }", context as never, "javascript", { source: "agent" });
  await wait(() => panels.length === 3); panels[2].fromWebview({ type: "ready" });
  await wait(() => panels[2].questions().length === 1); panels[2].fromWebview({ type: "explain" });
  const start = Date.now();
  while (await reviewCount() !== 3) {
    if (Date.now() - start > 2000) throw new Error("Explanation record was not queued");
    await new Promise(r => setTimeout(r, 5));
  }
  await new Promise(r => setImmediate(r));
  panels[2].fromWebview({ type: "next_question" });
  await wait(() => panels[2].questions().length === 2);
  panels[2].fromWebview({ type: "submit", selectedIndex: 1 });
  assert.equal(await followupGate, true);
  await box.flush(async () => ({ endpoint: f.backend.endpoint, token }));
  const history = f.backend.database.history(); assert.equal(history.length, 4);
  assert.equal(new Set(history.map(e => e.eventId)).size, 4);
  const graded = history.find(e => e.outcome === "pass")!;
  assert.equal(graded.score, 1); assert.equal(graded.answer, "6");
  assert.equal(history.find(e => e.outcome === "bypass")!.score, null);
  assert.equal(history.find(e => e.outcome === "explained")!.score, null);
  assert.equal(history.find(e => e.outcome === "explained")!.feedback, "Explanation requested.");
  assert.equal(f.backend.database.growth(null).completedChecks, 2);
});

async function waitUntil(predicate: () => boolean) {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > 2500) throw new Error("Quiz action timed out"); await new Promise(r => setTimeout(r, 5)); }
}

async function captureFixture(t: import("node:test").TestContext, first: GeneratedQuestion) {
  const f = await fixture(t); resetStub(); clearQuestionCache();
  settings.set("comprehensionGuard.desktopSyncEnabled", true);
  settings.set("comprehensionGuard.provider", "ollama");
  settings.set("comprehensionGuard.gradingMode", "multiple-choice");
  const context = Object.assign(fakeContext(), { globalStorageUri: { fsPath: path.join(f.directory, "extension"), toString: () => "test-storage" } });
  const realFetch = globalThis.fetch; let generated = 0;
  globalThis.fetch = async (input, init) => {
    if (!String(input).startsWith("http://127.0.0.1:11434")) return realFetch(input, init);
    const content = String(init?.body).includes("strict, impartial grader") ? judgeJson(["fail", "pass"])
      : generated++ === 0 ? first : MCQ_QUESTION;
    return new Response(JSON.stringify({ message: { content: JSON.stringify(content) } }), { headers: { "Content-Type": "application/json" } });
  };
  t.after(() => { globalThis.fetch = realFetch; vscodeWindow.visibleTextEditors.length = 0; resetStub(); });
  const box = new DashboardOutbox(path.join(context.globalStorageUri.fsPath, "dashboard-outbox"));
  return { ...f, context, box, sync: () => box.flush(async () => ({ endpoint: f.backend.endpoint, token })) };
}

function debugEditor(original: string) {
  let text = original;
  const editor = {
    document: { uri: { fsPath: "/project/app.ts" }, getText: () => text, positionAt: (index: number) => new Position(0, index) },
    edit: async (callback: (builder: { replace: (range: unknown, value: string) => void }) => void) => {
      callback({ replace: (_range, value) => { text = value; } }); return true;
    },
  };
  vscodeWindow.visibleTextEditors.push(editor); return editor;
}

const original = "function total() { return 6; }";
const orderingQuestion: GeneratedQuestion = { ...MCQ_QUESTION, kind: "ordering", question: "Order these steps", items: ["one", "two", "three"], correctOrder: [0, 1, 2] };
const debugQuestion: GeneratedQuestion = { ...MCQ_QUESTION, kind: "debug", question: "Restore the result", buggyCode: "function total() { return 5; }" };

for (const [question, submit, expectedScore] of [
  [MCQ_QUESTION, { type: "submit", selectedIndex: 0 }, 0],
  [orderingQuestion, { type: "submit", order: [0, 2, 1] }, 2 / 3],
  [FREE_TEXT_QUESTION, { type: "submit", answer: "It concatenates the items into a string." }, 0.5],
  [debugQuestion, { type: "submit" }, 0],
] as [GeneratedQuestion, Record<string, unknown> & { type: string }, number][]) {
  test(`${question.kind}: wrong answer then Next Question preserves failure, score, and memory before passing`, async t => {
    const f = await captureFixture(t, question);
    const editor = question.kind === "debug" ? debugEditor(original) : undefined;
    const gate = runComprehensionGate(original, f.context as never, "javascript", { source: "agent", filePath: "/project/app.ts" });
    await waitUntil(() => panels.length === 1); panels[0].fromWebview({ type: "ready" });
    await waitUntil(() => panels[0].questions().length === 1); panels[0].fromWebview(submit);
    await waitUntil(() => panels[0].feedback().length > 0);
    panels[0].fromWebview({ type: "next_question" });
    await waitUntil(() => panels[0].questions().length === 2);
    // Flush before the next answer: the failed question must already be durable.
    await f.sync();
    const failed = f.backend.database.history(); assert.equal(failed.length, 1);
    assert.equal(failed[0].outcome, "fail"); assert.equal(failed[0].score, expectedScore);
    if (editor) assert.equal(editor.document.getText(), original);
    panels[0].fromWebview({ type: "submit", selectedIndex: 1 }); assert.equal(await gate, true);
    await f.sync(); const history = f.backend.database.history(); assert.equal(history.length, 2);
    assert.notEqual(history[0].eventId, history[1].eventId);
    assert.equal(f.backend.database.growth(null).completedChecks, 2);
    assert.equal(getStats(f.context as never).passRate, 0.5);
  });
}

for (const action of ["cancel", "bypass", "explain"] as const) {
  test(`walkthrough debug ${action} is recorded locally and in dashboard without affecting mastery`, async t => {
    const f = await captureFixture(t, debugQuestion); const editor = debugEditor(original);
    const session = runSession(f.context as never, { snippet: original, filePath: "/project/app.ts", questions: [debugQuestion] });
    await waitUntil(() => panels.length === 1); panels[0].fromWebview({ type: "ready" });
    await waitUntil(() => panels[0].questions().length === 1); panels[0].fromWebview({ type: "submit" });
    await waitUntil(() => panels[0].feedback().length > 0); panels[0].fromWebview({ type: action });
    assert.equal(await session, action !== "cancel"); assert.equal(editor.document.getText(), original);
    await f.sync(); const [received] = f.backend.database.history();
    const expected = action === "cancel" ? "ungraded" : action === "explain" ? "explained" : "bypass";
    assert.equal(received.outcome, expected); assert.equal(received.score, null);
    const attempts = f.context.store.get("comprehensionGuard.attempts") as any[];
    assert.equal(attempts.length, 1); assert.equal(attempts[0].outcome, expected);
    assert.equal(f.context.store.get("comprehensionGuard.conceptMastery"), undefined);
    assert.equal(getStats(f.context as never).total, 0);
  });
}

test("dashboard runtime guard explains unsupported Node versions", () => {
  const { assertDashboardRuntime } = require("../scripts/check-dashboard-runtime.cjs");
  for (const version of ["20.19.0", "22.12.0"]) assert.throws(() => assertDashboardRuntime(version), /requires Node.js 22.13 or newer/);
  for (const version of ["22.13.0", "22.22.0", "24.0.0"]) assert.doesNotThrow(() => assertDashboardRuntime(version));
});

test("unavailable grading followed by a successful retry keeps distinct, consistent history records", async t => {
  const f = await captureFixture(t, FREE_TEXT_QUESTION as GeneratedQuestion);
  const route = globalThis.fetch; let gradingAvailable = false;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("http://127.0.0.1:11434") && String(init?.body).includes("strict, impartial grader")) {
      const content = gradingAvailable ? JSON.stringify(judgeJson(["pass", "pass"])) : "not valid grading JSON";
      return new Response(JSON.stringify({ message: { content } }), { headers: { "Content-Type": "application/json" } });
    }
    return route(input, init);
  };
  const gate = runComprehensionGate(original, f.context as never, "javascript", { source: "agent" });
  await waitUntil(() => panels.length === 1); panels[0].fromWebview({ type: "ready" });
  await waitUntil(() => panels[0].questions().length === 1);
  const submit = { type: "submit", answer: "It returns six by adding the numbers together." };
  panels[0].fromWebview(submit);
  await waitUntil(() => (f.context.store.get("comprehensionGuard.attempts") as any[] | undefined)?.length === 1);
  await waitUntil(() => panels[0].feedback().length > 0);
  await f.sync();
  const [ungraded] = f.backend.database.history();
  assert.equal(ungraded.outcome, "ungraded"); assert.equal(ungraded.score, null);
  assert.equal(f.context.store.get("comprehensionGuard.conceptMastery"), undefined);
  gradingAvailable = true; panels[0].fromWebview(submit); assert.equal(await gate, true);
  await f.sync(); const history = f.backend.database.history(); assert.equal(history.length, 2);
  assert.equal(history[0].outcome, "pass"); assert.notEqual(history[0].eventId, ungraded.eventId);
  assert.equal((await f.box.quarantined()).length, 0);
  const attempts = f.context.store.get("comprehensionGuard.attempts") as any[];
  assert.equal(attempts[0].outcome, "ungraded"); assert.equal(attempts[0].score, undefined);
  assert.equal(getStats(f.context as never).total, 1);
});

test("failed follow-up generation leaves the wrong answer unrecorded", async t => {
  const f = await captureFixture(t, MCQ_QUESTION as GeneratedQuestion);
  const gate = runComprehensionGate(original, f.context as never, "javascript", { source: "agent" });
  await waitUntil(() => panels.length === 1); panels[0].fromWebview({ type: "ready" });
  await waitUntil(() => panels[0].questions().length === 1);
  panels[0].fromWebview({ type: "submit", selectedIndex: 0 });
  await waitUntil(() => panels[0].feedback().length > 0);
  const route = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("http://127.0.0.1:11434")) return new Response("bad request", { status: 400 });
    return route(input, init);
  };
  panels[0].fromWebview({ type: "next_question" });
  await waitUntil(() => panels[0].feedback().some(m => String((m as { message?: string }).message ?? "").includes("Could not generate")));
  assert.equal(panels[0].questions().length, 1);
  await f.sync();
  assert.equal(f.backend.database.history().length, 0);
  assert.equal((f.context.store.get("comprehensionGuard.attempts") as unknown[] | undefined)?.length ?? 0, 0);
  globalThis.fetch = async (input, init) => {
    if (!String(input).startsWith("http://127.0.0.1:11434")) return route(input, init);
    return new Response(JSON.stringify({ message: { content: JSON.stringify(MCQ_QUESTION) } }), { headers: { "Content-Type": "application/json" } });
  };
  panels[0].fromWebview({ type: "next_question" });
  await waitUntil(() => panels[0].questions().length === 2);
  await f.sync();
  assert.equal(f.backend.database.history().length, 1);
  assert.equal(f.backend.database.history()[0].outcome, "fail");
  panels[0].fromWebview({ type: "submit", selectedIndex: 1 });
  assert.equal(await gate, true);
});

test("mastery keeps the newer row, edges replace a file, and a group reports coverage", async t => {
  const f = await fixture(t);
  const older = {
    schemaVersion: 1 as const, type: "mastery.updated" as const, eventId: "mastery-one", installationId: "test-install",
    occurredAt: 10, concept: "recursion", mastery: 0.2, elo: 1000, attempts: 1, lastSeen: 10,
  };
  const newer = { ...older, eventId: "mastery-two", occurredAt: 20, mastery: 0.6, elo: 1040, attempts: 2, lastSeen: 20 };
  assert.equal((await f.request("/v1/events", older)).status, 200);
  assert.equal((await f.request("/v1/events", newer)).status, 200);
  assert.equal((await f.request("/v1/events", older)).status, 200);
  const concepts = (await (await f.request("/v1/mastery")).json() as { concepts: { mastery: number }[] }).concepts;
  assert.equal(concepts.length, 1);
  assert.equal(concepts[0].mastery, 0.6);
  const edges = {
    schemaVersion: 1 as const, type: "file.edges" as const, eventId: "edges-one", installationId: "test-install",
    occurredAt: 30, fromPath: "src/a.ts", edges: [{ toPath: "src/b.ts", kind: "call" as const }],
  };
  assert.equal((await f.request("/v1/events", edges)).status, 200);
  assert.equal((await f.request("/v1/events", { ...edges, eventId: "edges-two", occurredAt: 31, edges: [] })).status, 200);
  assert.deepEqual((await (await f.request("/v1/files/edges")).json() as { edges: unknown[] }).edges, []);
  const group = randomUUID();
  const pass = event("pass", 1); pass.groupId = group;
  const fail = event("fail", 0); fail.groupId = group;
  await f.request("/v1/events", pass); await f.request("/v1/events", fail);
  const grouped = (await (await f.request("/v1/checks")).json() as { checks: { groupId: string; asked: number; passed: number }[] }).checks;
  const row = grouped.find(item => item.groupId === group);
  assert.equal(row?.asked, 2); assert.equal(row?.passed, 1);
});
