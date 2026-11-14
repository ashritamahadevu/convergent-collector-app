import "./installVscodeStub";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import * as vscodeStub from "./vscodeStub";
import {
  FREE_TEXT_QUESTION,
  MCQ_QUESTION,
  OLLAMA,
  SNIPPET,
  closedPort,
  fakeContext,
  fetchLog,
  judgeJson,
  ollamaReply,
  openAiReply,
  redirectFetch,
  startMockServer,
  type MockServer,
} from "./harness";
import { clearQuestionCache, generateQuestion, judge, setLogSink } from "../../src/llm";
import type { GeneratedQuestion } from "../../src/types";

/**
 * llm.ts under provider failures. Real sockets to a mock server; the real
 * Ollama on :11434 is never contacted (see harness.redirectFetch).
 */

let server: MockServer;
let restoreFetch: () => void = () => {};
const logs: string[] = [];

function useOllama(target: string): void {
  restoreFetch();
  vscodeStub.settings.set("comprehensionGuard.provider", "ollama");
  restoreFetch = redirectFetch([{ from: OLLAMA, to: target }]);
}

function useOpenAi(target: string, ctx: ReturnType<typeof fakeContext>): void {
  restoreFetch();
  vscodeStub.settings.set("comprehensionGuard.provider", "openai");
  ctx.secretStore.set("comprehensionGuard.apiKey.openai", "sk-test-not-a-real-key");
  restoreFetch = redirectFetch([{ from: "https://api.openai.com", to: target }]);
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value?: T; error?: Error }> {
  const start = Date.now();
  try {
    const value = await fn();
    return { ms: Date.now() - start, value };
  } catch (err) {
    return { ms: Date.now() - start, error: err as Error };
  }
}

const gen = (ctx: ReturnType<typeof fakeContext>, mode: "free-text" | "multiple-choice" = "free-text") =>
  generateQuestion({ context: ctx as never, snippet: SNIPPET, language: "javascript", mode });

const runJudge = (ctx: ReturnType<typeof fakeContext>, question: GeneratedQuestion = FREE_TEXT_QUESTION as GeneratedQuestion) =>
  judge({ context: ctx as never, snippet: SNIPPET, language: "javascript", question, studentAnswer: "It returns 6, the sum." });

before(async () => {
  server = await startMockServer();
  setLogSink((line) => logs.push(line));
});

after(async () => {
  restoreFetch();
  server.releaseHung({ kind: "json", body: {} });
  await server.close();
});

beforeEach(() => {
  clearQuestionCache();
  vscodeStub.resetStub();
  server.requests.length = 0;
  logs.length = 0;
});

describe("environment facts the code relies on", () => {
  test("an aborted fetch rejects with an Error named AbortError (isAbortError works)", async () => {
    useOllama(server.base);
    server.handler = () => ({ kind: "hang" });
    const controller = new AbortController();
    const p = fetch(server.base + "/x", { method: "POST", body: "{}", signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    const err = await p.catch((e) => e);
    assert.equal(err.name, "AbortError");
    assert.ok(err instanceof Error);
  });
});

describe("question generation: network down before the quiz", () => {
  test("ollama connection refused fails fast, no retry, readable message", async () => {
    const port = await closedPort();
    useOllama("http://127.0.0.1:" + port);
    const ctx = fakeContext();
    const r = await timed(() => gen(ctx));
    assert.ok(r.error, "should reject");
    assert.match(r.error!.message, /Could not reach Ollama/);
    assert.ok(r.ms < 3000, "fast fail, took " + r.ms);
    console.log("[observed] ollama refused -> " + r.ms + "ms: " + r.error!.message);
  });

  test("DNS failure (openai -> *.invalid) fails fast and is not retried", async () => {
    const ctx = fakeContext();
    useOpenAi("https://cg-network-test.invalid", ctx);
    const before = fetchLog.length;
    const r = await timed(() => gen(ctx));
    assert.ok(r.error);
    assert.equal(fetchLog.length - before, 1, "one attempt");
    assert.ok(r.ms < 10000, "took " + r.ms);
    console.log("[observed] DNS failure -> " + r.ms + "ms: " + r.error!.message);
  });

  test("connection refused on a hosted provider (openai) fails fast with a generic 'fetch failed'", async () => {
    const ctx = fakeContext();
    const port = await closedPort();
    useOpenAi("http://127.0.0.1:" + port, ctx);
    const r = await timed(() => gen(ctx));
    assert.ok(r.error);
    assert.ok(r.ms < 3000, "took " + r.ms);
    console.log("[observed] openai refused -> " + r.ms + "ms: " + r.error!.message);
  });

  test("TLS error (https to a plain-http port) fails fast and is not retried", async () => {
    const ctx = fakeContext();
    useOpenAi("https://127.0.0.1:" + server.port, ctx);
    server.handler = () => ({ kind: "json", body: {} });
    const r = await timed(() => gen(ctx));
    assert.ok(r.error);
    assert.ok(r.ms < 5000, "took " + r.ms);
    console.log("[observed] TLS error -> " + r.ms + "ms: " + r.error!.message);
  });

  test("HTTP 429 three times: 3 attempts with 600ms/1200ms backoff, then rejects (~1.8s total)", async () => {
    const ctx = fakeContext();
    useOpenAi(server.base, ctx);
    server.handler = () => ({ kind: "json", status: 429, body: { error: { message: "Rate limit" } } });
    const r = await timed(() => gen(ctx));
    assert.ok(r.error);
    assert.match(r.error!.message, /\(429\)/);
    assert.equal(server.requests.length, 3);
    const gaps = server.requests.slice(1).map((q, i) => q.at - server.requests[i].at);
    assert.ok(gaps[0] >= 550 && gaps[1] >= 1150, "gaps " + gaps.join(","));
    console.log("[observed] 429x3 -> " + r.ms + "ms, gaps " + gaps.join("/") + "ms; Retry-After is not read");
  });

  test("HTTP 429 once then success: recovers on retry", async () => {
    const ctx = fakeContext();
    useOpenAi(server.base, ctx);
    server.handler = (_q, i) =>
      i === 0 ? { kind: "json", status: 429, body: {} } : openAiReply(FREE_TEXT_QUESTION);
    const r = await timed(() => gen(ctx));
    assert.ifError(r.error);
    assert.equal(r.value!.question, FREE_TEXT_QUESTION.question);
    assert.equal(server.requests.length, 2);
  });

  test("HTTP 500 and 503 are retried; 401 (bad key) is not", async () => {
    const ctx = fakeContext();
    useOpenAi(server.base, ctx);
    for (const status of [500, 503]) {
      server.requests.length = 0;
      server.handler = () => ({ kind: "text", status, text: "upstream error" });
      const r = await timed(() => gen(ctx));
      assert.ok(r.error);
      assert.equal(server.requests.length, 3, "status " + status);
    }
    server.requests.length = 0;
    server.handler = () => ({ kind: "json", status: 401, body: { error: { message: "Incorrect API key provided" } } });
    const r = await timed(() => gen(ctx));
    assert.ok(r.error);
    assert.match(r.error!.message, /\(401\)/);
    assert.equal(server.requests.length, 1);
    assert.ok(r.ms < 2000);
  });

  test("HTTP 502 with an HTML error page is retried 3 times then rejects", async () => {
    const ctx = fakeContext();
    useOpenAi(server.base, ctx);
    server.handler = () => ({ kind: "text", status: 502, text: "<html><body>Bad Gateway</body></html>", contentType: "text/html" });
    const r = await timed(() => gen(ctx));
    assert.ok(r.error);
    assert.equal(server.requests.length, 3);
  });

  test("HTTP 200 with an HTML page (captive portal) or empty body rejects without retry", async () => {
    const ctx = fakeContext();
    useOpenAi(server.base, ctx);
    for (const text of ["<html><body>Sign in to Wi-Fi</body></html>", ""]) {
      server.requests.length = 0;
      server.handler = () => ({ kind: "text", status: 200, text, contentType: "text/html" });
      const r = await timed(() => gen(ctx));
      assert.ok(r.error, "should reject for body " + JSON.stringify(text));
      assert.equal(server.requests.length, 1);
      console.log("[observed] 200 body " + JSON.stringify(text.slice(0, 20)) + " -> " + r.error!.message);
    }
  });

  test("model text that is truncated / not JSON rejects with a parse error", async () => {
    useOllama(server.base);
    const full = JSON.stringify(FREE_TEXT_QUESTION);
    server.handler = () => ollamaReply(full.slice(0, Math.floor(full.length / 2)));
    const r = await timed(() => gen(fakeContext()));
    assert.ok(r.error);
    assert.match(r.error!.message, /parse/i);
  });

  test("connection reset before any response rejects (ollama: 'Could not reach')", async () => {
    useOllama(server.base);
    server.handler = () => ({ kind: "reset" });
    const r = await timed(() => gen(fakeContext()));
    assert.ok(r.error);
    console.log("[observed] reset -> " + r.error!.message);
  });

  test("transport truncated mid-body (socket closed early) rejects, not retried", async () => {
    useOllama(server.base);
    const body = { message: { content: JSON.stringify(FREE_TEXT_QUESTION) } };
    server.handler = () => ({ kind: "truncate", body, cutAt: 40 });
    const r = await timed(() => gen(fakeContext()));
    assert.ok(r.error);
    assert.equal(server.requests.length, 1);
    console.log("[observed] truncated body -> " + r.error!.message);
  });

  test("multiple-choice with empty options rejects (caller falls back)", async () => {
    useOllama(server.base);
    server.handler = () => ollamaReply({ ...MCQ_QUESTION, options: [] });
    const r = await timed(() => gen(fakeContext(), "multiple-choice"));
    assert.ok(r.error);
    assert.match(r.error!.message, /3-4 options/);
  });

  test("BUG: free-text with no criteria is accepted (after a second paid call) and comes back with criteria: []", async () => {
    useOllama(server.base);
    const { criteria: _drop, ...noCriteria } = FREE_TEXT_QUESTION;
    void _drop;
    server.handler = () => ollamaReply(noCriteria);
    const r = await timed(() => gen(fakeContext()));
    assert.ifError(r.error);
    assert.deepEqual(r.value!.criteria, []);
    assert.equal(r.value!.flagged, true);
    assert.equal(server.requests.length, 2);
  });

  test("a 1-criterion rubric (allowed by the prompt: '1-3 criteria') always triggers a second generation call", async () => {
    useOllama(server.base);
    server.handler = () => ollamaReply({ ...FREE_TEXT_QUESTION, criteria: [FREE_TEXT_QUESTION.criteria[0]] });
    const r = await timed(() => gen(fakeContext()));
    assert.ifError(r.error);
    assert.equal(server.requests.length, 2, "generation ran twice");
    assert.equal(r.value!.flagged, true);
  });

  test("slow but under the timeout (3s) succeeds", async () => {
    useOllama(server.base);
    server.handler = () => ({ ...ollamaReply(FREE_TEXT_QUESTION), delayMs: 3000 } as never);
    const r = await timed(() => gen(fakeContext()));
    assert.ifError(r.error);
    assert.ok(r.ms >= 2900);
  });
});

describe("grading: network drops after the question is shown", () => {
  test("connection refused during grading -> no_decision after 2 attempts (~0.6s)", async () => {
    const port = await closedPort();
    useOllama("http://127.0.0.1:" + port);
    const r = await timed(() => runJudge(fakeContext()));
    assert.deepEqual(r.value, { kind: "no_decision", reason: "provider_error" });
    assert.ok(r.ms < 3000);
    console.log("[observed] judge refused -> no_decision in " + r.ms + "ms");
  });

  test("outage that recovers 2s later is not waited for: no_decision", async () => {
    useOllama(server.base);
    const downUntil = Date.now() + 2000;
    server.handler = () =>
      Date.now() < downUntil ? { kind: "reset" } : ollamaReply(judgeJson(["fail", "fail"]));
    const r = await timed(() => runJudge(fakeContext()));
    assert.equal(r.value!.kind, "no_decision");
    assert.equal(server.requests.length, 2);
  });

  test("outage that recovers within ~0.5s is retried successfully", async () => {
    useOllama(server.base);
    server.handler = (_q, i) => (i === 0 ? { kind: "reset" } : ollamaReply(judgeJson(["pass", "pass"])));
    const r = await timed(() => runJudge(fakeContext()));
    assert.equal(r.value!.kind, "decided");
  });

  test("429 on the judge: one retry after 600ms, then no_decision", async () => {
    useOllama(server.base);
    server.handler = () => ({ kind: "json", status: 429, body: {} });
    const r = await timed(() => runJudge(fakeContext()));
    assert.deepEqual(r.value, { kind: "no_decision", reason: "provider_error" });
    assert.equal(server.requests.length, 2);
  });

  test("401 on the judge -> no_decision (not surfaced as a key problem)", async () => {
    const ctx = fakeContext();
    useOpenAi(server.base, ctx);
    server.handler = () => ({ kind: "json", status: 401, body: { error: { message: "bad key" } } });
    const r = await runJudge(ctx);
    assert.deepEqual(r, { kind: "no_decision", reason: "provider_error" });
  });

  test("truncated judge JSON (token cap) -> no_decision parse_failed", async () => {
    useOllama(server.base);
    const raw = JSON.stringify(judgeJson(["fail", "fail"]));
    server.handler = () => ollamaReply(raw.slice(0, raw.indexOf("c2") - 5));
    const r = await runJudge(fakeContext());
    assert.deepEqual(r, { kind: "no_decision", reason: "parse_failed" });
  });

  test("BUG: judge says FAIL in upper case -> no_decision (and quiz.ts then passes the student)", async () => {
    useOllama(server.base);
    const raw = JSON.stringify(judgeJson(["fail", "fail"])).replace(/"fail"/g, '"FAIL"');
    server.handler = () => ollamaReply(raw);
    const r = await runJudge(fakeContext());
    assert.deepEqual(r, { kind: "no_decision", reason: "parse_failed" });
  });

  test("BUG: judge renames criterion ids -> 'decided' with ids that do not match (aggregate then fails a correct answer)", async () => {
    useOllama(server.base);
    server.handler = () => ollamaReply(judgeJson(["pass", "pass"], ["criterion_1", "criterion_2"]));
    const r = await runJudge(fakeContext());
    assert.equal(r.kind, "decided");
    if (r.kind === "decided") {
      assert.deepEqual(r.verdicts.map((v) => v.id), ["criterion_1", "criterion_2"]);
    }
  });

  test("question with no criteria -> judge returns 'decided' with no verdicts and never calls the model", async () => {
    useOllama(server.base);
    const r = await runJudge(fakeContext(), { ...FREE_TEXT_QUESTION, criteria: [] } as GeneratedQuestion);
    assert.deepEqual(r, { kind: "decided", verdicts: [] });
    assert.equal(server.requests.length, 0);
  });
});
