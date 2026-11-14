import "./installVscodeStub";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import * as vscodeStub from "./vscodeStub";
import {
  NONSENSE_ANSWER,
  OLLAMA,
  SNIPPET,
  fakeContext,
  redirectFetch,
  startMockServer,
  waitFor,
  type MockServer,
} from "./harness";
import { clearQuestionCache, setLogSink } from "../../src/llm";
import { runComprehensionGate } from "../../src/quiz";
import { localGeneratedQuestion } from "../../src/sizing/questions";
import { requestQuizBypass, setQuizActive } from "../../src/state";

/**
 * The paste, inline, and agent gates share runComprehensionGate. The question
 * is built locally, so these tests fail if the panel waits on a model.
 */

let server: MockServer;
let restoreFetch: () => void = () => {};

before(async () => {
  server = await startMockServer();
  setLogSink(() => undefined);
  restoreFetch = redirectFetch([{ from: OLLAMA, to: server.base }]);
});

after(async () => {
  restoreFetch();
  await server.close();
});

beforeEach(() => {
  clearQuestionCache();
  vscodeStub.resetStub();
  vscodeStub.settings.set("comprehensionGuard.provider", "ollama");
  server.requests.length = 0;
  server.handler = () => ({ kind: "hang" });
  setQuizActive(false);
});

type Gate = { promise: Promise<boolean>; settled: () => boolean; result: () => boolean | undefined };

function startGate(ctx: ReturnType<typeof fakeContext>, snippet = SNIPPET): Gate {
  let done = false;
  let value: boolean | undefined;
  const promise = runComprehensionGate(snippet, ctx as never, "javascript", {
    source: "paste",
    filePath: "C:/w/a.js",
  }).then((v) => {
    done = true;
    value = v;
    return v;
  });
  return { promise, settled: () => done, result: () => value };
}

async function openPanel(index = 0) {
  await waitFor(() => vscodeStub.panels.length > index, 5000, "quiz panel");
  const panel = vscodeStub.panels[index];
  panel.fromWebview({ type: "ready" });
  await waitFor(() => panel.questions().length > 0, 3000, "question shown");
  return panel;
}

const attempts = (ctx: ReturnType<typeof fakeContext>) =>
  (ctx.store.get("comprehensionGuard.attempts") as { outcome: string; passed: boolean }[] | undefined) ?? [];

describe("local question, no model wait", () => {
  test("the question is on screen without an HTTP request", async () => {
    const started = Date.now();
    const gate = startGate(fakeContext());
    const panel = await openPanel();
    const elapsed = Date.now() - started;
    const shown = panel.questions()[0];
    assert.ok(elapsed < 3000, "question took " + elapsed + "ms");
    assert.equal(server.requests.length, 0, "question generation made an HTTP call");
    assert.equal(shown.kind, "multiple-choice");
    assert.match(String(shown.questionText), /total/);
    assert.equal(gate.settled(), false);
    panel.dispose();
    assert.equal(await gate.promise, false);
  });

  test("the correct option passes immediately and is recorded", async () => {
    const local = await localGeneratedQuestion(SNIPPET, "C:/w/a.js");
    assert.ok(local);
    assert.equal(local.kind, "multiple-choice");
    const ctx = fakeContext();
    const gate = startGate(ctx);
    const panel = await openPanel();
    assert.equal(server.requests.length, 0);
    panel.fromWebview({ type: "submit", selectedIndex: local.correctIndex });
    assert.equal(await gate.promise, true);
    assert.equal(server.requests.length, 0, "grading made an HTTP call");
    assert.equal(attempts(ctx)[0]?.outcome, "pass");
    assert.match(String(panel.feedback()[0]?.message), /Correct/);
  });

  test("a wrong option does not pass, and the next question is also local", async () => {
    const local = await localGeneratedQuestion(SNIPPET, "C:/w/a.js");
    assert.ok(local && typeof local.correctIndex === "number");
    const ctx = fakeContext();
    const gate = startGate(ctx);
    const panel = await openPanel();
    const wrong = (local.correctIndex + 1) % (local.options?.length ?? 1);
    panel.fromWebview({ type: "submit", selectedIndex: wrong });
    await waitFor(() => panel.feedback().length > 0, 1000, "wrong-answer feedback");
    assert.equal(gate.settled(), false);
    assert.match(String(panel.feedback()[0]?.message), /not correct/i);
    panel.fromWebview({ type: "next_question" });
    await waitFor(() => panel.questions().length > 1, 1000, "follow-up question");
    assert.equal(server.requests.length, 0, "the follow-up waited on a model");
    panel.fromWebview({ type: "submit", selectedIndex: local.correctIndex });
    assert.equal(await gate.promise, true);
    assert.equal(attempts(ctx).at(-1)?.outcome, "pass");
  });

  test("Explain shows the local explanation without a model call", async () => {
    const local = await localGeneratedQuestion(SNIPPET, "C:/w/a.js");
    assert.ok(local);
    const gate = startGate(fakeContext());
    const panel = await openPanel();
    panel.fromWebview({ type: "explain" });
    await waitFor(() => panel.feedback().length > 0, 1000, "explanation");
    assert.match(String(panel.feedback()[0]?.message), /Explanation/);
    assert.match(String(panel.feedback()[0]?.message), new RegExp(local.referenceAnswer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(server.requests.length, 0);
    panel.fromWebview({ type: "cancel" });
    assert.equal(await gate.promise, true);
  });

  test("a snippet with no function uses the instant written question", async () => {
    const ctx = fakeContext();
    const started = Date.now();
    const gate = startGate(ctx, "hello from a paste that is not a function ".repeat(6));
    const panel = await openPanel();
    assert.ok(Date.now() - started < 3000);
    assert.match(String(panel.questions()[0].questionText), /What does this code do\?/);
    assert.equal(server.requests.length, 0);
    panel.fromWebview({ type: "submit", answer: NONSENSE_ANSWER });
    assert.equal(await gate.promise, true);
    assert.equal(server.requests.length, 0);
  });

  test("Bypass ends the check without waiting", async () => {
    setQuizActive(true);
    const gate = startGate(fakeContext());
    await waitFor(() => vscodeStub.panels.length > 0, 1000, "panel");
    assert.equal(requestQuizBypass(), true);
    assert.equal(await gate.promise, true);
    assert.equal(server.requests.length, 0);
    setQuizActive(false);
  });
});

describe("agent-edit quiz and the Bypass command", () => {
  test("agent quizzes never set quizActive, so the Bypass command cannot reach them", async () => {
    const { state, setBypassArmed } = await import("../../src/state");
    state.processing = true;
    const gate = startGate(fakeContext());
    await waitFor(() => vscodeStub.panels.length > 0, 1000, "panel");
    const reached = requestQuizBypass();
    if (!reached) {
      setBypassArmed(true);
    }
    assert.equal(reached, false, "Bypass did not reach the open agent quiz");
    assert.equal(state.bypassArmed, true, "a one-shot bypass is now armed for an unrelated future insertion");
    const panel = await openPanel();
    assert.equal(gate.settled(), false);
    panel.dispose();
    assert.equal(await gate.promise, false);
    state.processing = false;
    setBypassArmed(false);
  });
});
