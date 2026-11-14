import "./installVscodeStub";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import * as vscodeStub from "./vscodeStub";
import { closedPort, fakeContext, startMockServer, waitFor, type MockServer } from "./harness";
import { flushSync, queueReview, signIn } from "../../src/memory/sync";
import { logReview } from "../../src/memory/remember";

/**
 * Supabase sync (src/memory/sync.ts) with the network down, flaky, or slow.
 * Supabase URL points at a local mock or a closed port. No real project.
 */

const QUEUE_KEY = "comprehensionGuard.syncQueue";
const SESSION_KEY = "comprehensionGuard.supabaseSession";
let server: MockServer;
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

before(async () => {
  server = await startMockServer();
  process.on("unhandledRejection", onUnhandled);
});

after(async () => {
  process.off("unhandledRejection", onUnhandled);
  server.releaseHung({ kind: "json", body: {} });
  await server.close();
  assert.deepEqual(unhandled, [], "no unhandled rejections from sync");
});

beforeEach(() => {
  vscodeStub.resetStub();
  server.requests.length = 0;
});

function configure(url: string): void {
  vscodeStub.settings.set("comprehensionGuard.supabaseUrl", url);
  vscodeStub.settings.set("comprehensionGuard.supabaseAnonKey", "anon-test-key");
}

function signedInContext() {
  const ctx = fakeContext();
  ctx.secretStore.set(
    SESSION_KEY,
    JSON.stringify({ accessToken: "test-access", refreshToken: "test-refresh", userId: "u-test", expiresAt: Date.now() - 1000 }),
  );
  return ctx;
}

const review = (n: number) => ({
  concepts: ["control-flow"],
  eventKind: "check",
  followups: 0,
  askedForExplanation: false,
  question: "q" + n,
});

const queue = (ctx: ReturnType<typeof fakeContext>) => (ctx.store.get(QUEUE_KEY) as { row: { question?: string } }[]) ?? [];
const settle = () => new Promise((r) => setTimeout(r, 300));

describe("supabase sync offline", () => {
  test("offline: op stays queued, nothing throws, the caller is not blocked", async () => {
    configure("http://127.0.0.1:" + (await closedPort()));
    const ctx = signedInContext();
    const start = Date.now();
    queueReview(ctx as never, review(1));
    assert.ok(Date.now() - start < 50, "queueReview is fire-and-forget");
    await settle();
    assert.equal(queue(ctx).length, 1);
  });

  test("network back: queue is only retried when something new is queued (no timer, no online event)", async () => {
    configure("http://127.0.0.1:" + (await closedPort()));
    const ctx = signedInContext();
    queueReview(ctx as never, review(1));
    await settle();
    configure(server.base); // network back
    server.handler = () => ({ kind: "json", status: 201, body: {} });
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(queue(ctx).length, 0, "a failed flush retries without a new event");
    queueReview(ctx as never, review(2));
    await waitFor(() => queue(ctx).length === 0, 3000, "queue drained");
    assert.ok(server.requests.length >= 2);
  });

  test("BUG: concurrent flushes overwrite each other -> a queued event is lost while offline", async () => {
    configure(server.base);
    const ctx = signedInContext();
    // First request is slow, the rest fail fast: all are 503 (offline-ish upstream).
    server.handler = (_q, i) => (i === 0 ? { kind: "json", status: 503, body: {}, delayMs: 500 } : { kind: "json", status: 503, body: {} });
    queueReview(ctx as never, review(1)); // flush #1 snapshot [q1], slow
    await new Promise((r) => setTimeout(r, 50));
    queueReview(ctx as never, review(2)); // flush #2 snapshot [q1,q2], fast; writes [q1,q2]
    await new Promise((r) => setTimeout(r, 1200)); // flush #1 finishes last and writes [q1]
    const left = queue(ctx).map((op) => op.row.question);
    console.log("[observed] queue after two offline flushes: " + JSON.stringify(left));
    assert.deepEqual(left.sort(), ["q1", "q2"]);
  });

  test("BUG: concurrent flushes double-insert review_events when online", async () => {
    configure(server.base);
    const ctx = signedInContext();
    const session = JSON.parse(ctx.secretStore.get(SESSION_KEY) as string) as { expiresAt: number };
    session.expiresAt = Date.now() + 3_600_000;
    ctx.secretStore.set(SESSION_KEY, JSON.stringify(session));
    server.handler = (_q, i) => ({ kind: "json", status: 201, body: {}, delayMs: i === 0 ? 400 : 0 });
    queueReview(ctx as never, review(1));
    await new Promise((r) => setTimeout(r, 50));
    queueReview(ctx as never, review(2));
    await new Promise((r) => setTimeout(r, 1000));
    const q1Posts = server.requests.filter((r) => r.body.includes('"question":"q1"')).length;
    console.log("[observed] q1 POSTed " + q1Posts + " times to " + server.requests[0]?.url);
    assert.equal(q1Posts, 1, "insert-only row is sent once");
    assert.equal(queue(ctx).length, 0);
  });

  test("BUG: long offline stretch drops the oldest events beyond 200 queued ops, silently", async () => {
    configure("http://127.0.0.1:" + (await closedPort()));
    const ctx = fakeContext(); // signed out: nothing is attempted, everything queues
    for (let i = 0; i < 250; i++) {
      queueReview(ctx as never, review(i));
    }
    await settle();
    const q = queue(ctx);
    assert.equal(q.length, 250);
    assert.equal(q[0].row.question, "q0");
  });

  test("BUG: expired session -> every upsert 401s, no refresh is attempted, queue never drains", async () => {
    configure(server.base);
    const ctx = signedInContext(); // expiresAt in the past
    server.handler = () => ({ kind: "json", status: 401, body: { message: "JWT expired" } });
    queueReview(ctx as never, review(1));
    await settle();
    queueReview(ctx as never, review(2));
    await settle();
    assert.equal(queue(ctx).length, 2);
    assert.equal(server.requests.some((r) => r.url.includes("refresh_token")), true);
  });

  test("hung Supabase does not block logReview (what quiz.ts awaits)", async () => {
    configure(server.base);
    const ctx = signedInContext();
    server.handler = () => ({ kind: "hang" });
    const start = Date.now();
    await logReview(ctx as never, review(1) as never);
    assert.ok(Date.now() - start < 200, "took " + (Date.now() - start));
    // The background flush is still waiting on the socket (no fetch timeout in sync.ts).
    assert.equal(queue(ctx).length, 1);
    server.releaseHung({ kind: "json", status: 201, body: {} });
    void flushSync;
  });

  test("sign-in offline / HTML error page: rejects with a raw message (handled by the command)", async () => {
    configure("http://127.0.0.1:" + (await closedPort()));
    const err1 = await signIn(fakeContext() as never, "a@example.test", "test-password").catch((e: Error) => e);
    assert.ok(err1 instanceof Error);
    configure(server.base);
    server.handler = () => ({ kind: "text", status: 502, text: "<html>Bad gateway</html>", contentType: "text/html" });
    const err2 = await signIn(fakeContext() as never, "a@example.test", "test-password").catch((e: Error) => e);
    assert.ok(err2 instanceof Error);
    console.log("[observed] signIn offline -> '" + err1.message + "'; signIn 502 html -> '" + err2.message + "'");
  });
});
