import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { startDashboardBackend } from "../desktop/backend/server";
import { DashboardOutbox } from "../src/dashboard/outbox";
import { isCheckEvent, localEndpoint, type CheckEvent } from "../src/dashboard/protocol";
import { recordDashboardCheck } from "../src/dashboard/service";
import { settings, panels, resetStub } from "./network/vscodeStub";
import { fakeContext, MCQ_QUESTION } from "./network/harness";
import { runComprehensionGate, runSession } from "../src/quiz";
import type { GeneratedQuestion } from "../src/types";

const token = "a".repeat(64);
const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
function event(outcome: CheckEvent["check"]["outcome"] = "pass", score: number | null = 1): CheckEvent {
  return { schemaVersion: 1, type: "check.recorded", eventId: randomUUID(), installationId: "test-install",
    occurredAt: Date.now(), project: { id: "project-1", name: "Example" },
    check: { concepts: ["control-flow"], question: "What returns?", answer: "One", feedback: "Correct.",
      misconception: "", outcome, score, source: "agent", mode: "free-text", filePath: "src/app.ts", retries: 0 } };
}
async function fixture(t: import("node:test").TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "drawbridge-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
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
  const conflicting = structuredClone(e); conflicting.check.answer = "Different";
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
  const e = event(); e.check.score = 6;
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

test("bad acknowledgement and hung responses never delete queued events", async t => {
  const f = await fixture(t); const box = new DashboardOutbox(path.join(f.directory, "outbox"));
  await box.enqueue(event());
  let hanging = false;
  const mock = createServer((req, res) => {
    req.resume();
    if (hanging) return;
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ eventId: "wrong" }));
  });
  await new Promise<void>(resolve => mock.listen(0, "127.0.0.1", resolve));
  t.after(() => { mock.closeAllConnections(); mock.close(); });
  const endpoint = "http://127.0.0.1:" + (mock.address() as import("node:net").AddressInfo).port;
  await box.flush(async () => ({ endpoint, token }));
  assert.equal((await box.pending()).length, 1); assert.match(box.lastError!, /acknowledge/);
  hanging = true;
  const start = Date.now(); await box.flush(async () => ({ endpoint, token }));
  assert.ok(Date.now() - start < 4500); assert.equal((await box.pending()).length, 1);
});

test("protocol refuses external endpoints, absolute paths, and scores on bypasses", () => {
  for (const url of ["https://example.com", "http://localhost:80", "http://127.0.0.1/path", "http://user:pass@127.0.0.1"]) assert.throws(() => localEndpoint(url));
  assert.equal(isCheckEvent(event("bypass", 1)), false);
  const e = event(); e.check.filePath = "/Users/example/project/file.ts"; assert.equal(isCheckEvent(e), false);
  e.check.filePath = "../outside.ts"; assert.equal(isCheckEvent(e), false);
});

test("extension capture is opt-in and persists question details without source code or absolute paths", async t => {
  const f = await fixture(t); const store = new Map<string, unknown>();
  const storage = path.join(f.directory, "extension");
  const context = { globalStorageUri: { fsPath: storage, toString: () => storage },
    globalState: { get: (k: string) => store.get(k), update: async (k: string, v: unknown) => { store.set(k, v); } },
    secrets: { get: async () => undefined } } as any;
  const e = event(); const input = { eventId: e.eventId, timestamp: e.occurredAt, filePath: "/private/project/app.ts", check: e.check };
  settings.set("comprehensionGuard.desktopSyncEnabled", false);
  await recordDashboardCheck(context, input);
  await assert.rejects(fs.readdir(storage));
  settings.set("comprehensionGuard.desktopSyncEnabled", true);
  t.after(() => settings.delete("comprehensionGuard.desktopSyncEnabled"));
  await recordDashboardCheck(context, input);
  const files = await fs.readdir(path.join(storage, "dashboard-outbox"));
  const saved = JSON.parse(await fs.readFile(path.join(storage, "dashboard-outbox", files[0]), "utf8"));
  assert.equal(saved.check.filePath, null); assert.equal(saved.check.question, e.check.question);
  assert.equal(saved.project.name, "Unassigned"); assert.equal(saved.check.score, 1);
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
  const followupGate = runComprehensionGate("function total() { return 6; }", context as never, "javascript", { source: "agent" });
  await wait(() => panels.length === 3); panels[2].fromWebview({ type: "ready" });
  await wait(() => panels[2].questions().length === 1); panels[2].fromWebview({ type: "explain" });
  const start = Date.now();
  while ((await box.pending()).length !== 3) {
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
  const graded = history.find(e => e.check.outcome === "pass")!;
  assert.equal(graded.check.score, 1); assert.equal(graded.check.answer, "6");
  assert.equal(history.find(e => e.check.outcome === "bypass")!.check.score, null);
  assert.equal(history.find(e => e.check.outcome === "explained")!.check.score, null);
  assert.equal(f.backend.database.growth(null).completedChecks, 2);
});
