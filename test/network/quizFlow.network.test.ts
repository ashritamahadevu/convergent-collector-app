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
  ollamaReply,
  redirectFetch,
  startMockServer,
  waitFor,
  type MockServer,
} from "./harness";
import { clearQuestionCache, setLogSink } from "../../src/llm";
import { runComprehensionGate } from "../../src/quiz";
import { requestQuizBypass, setQuizActive } from "../../src/state";

/**
 * The paste, inline, and agent gates share runComprehensionGate. The question
 * the student sees is the one the model returns.
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
  server.releaseHung({ kind: "json", body: {} });
  await server.close();
});

function routeOllamaTo(target: string): void {
  restoreFetch();
  restoreFetch = redirectFetch([{ from: OLLAMA, to: target }]);
}

beforeEach(() => {
  clearQuestionCache();
  vscodeStub.resetStub();
  vscodeStub.settings.set("comprehensionGuard.provider", "ollama");
  server.requests.length = 0;
  server.handler = () => ollamaReply(FREE_TEXT_QUESTION);
  routeOllamaTo(server.base);
  setQuizActive(false);
});

type Gate = { promise: Promise<boolean>; settled: () => boolean };

function startGate(ctx: ReturnType<typeof fakeContext>): Gate {
  let done = false;
  const promise = runComprehensionGate(SNIPPET, ctx as never, "javascript", {
    source: "paste",
    filePath: "C:/w/a.js",
  }).then((value) => {
    done = true;
    return value;
  });
  return { promise, settled: () => done };
}

async function openPanel(index = 0) {
  await waitFor(() => vscodeStub.panels.length > index, 5000, "quiz panel");
  const panel = vscodeStub.panels[index];
  panel.fromWebview({ type: "ready" });
  await waitFor(() => panel.questions().length > 0, 3000, "question shown");
  return panel;
}

function generateRequests(): { body: string }[] {
  return server.requests.filter((request) => request.kind === "generate");
}

describe("the model writes the question", () => {
  test("the panel shows the question the model returned", async () => {
    const gate = startGate(fakeContext());
    const panel = await openPanel();
    const shown = panel.questions()[0];
    assert.equal(shown.questionText, FREE_TEXT_QUESTION.question);
    assert.ok(generateRequests().length >= 1, "the check never asked the model for a question");
    assert.match(generateRequests()[0].body, /Generate ONE/);
    assert.match(generateRequests()[0].body, /function total/);
    panel.dispose();
    assert.equal(await gate.promise, false);
  });

  test("a follow-up asks the model for another question", async () => {
    server.handler = () => ollamaReply(MCQ_QUESTION);
    const gate = startGate(fakeContext());
    const panel = await openPanel();
    assert.equal(panel.questions()[0].questionText, MCQ_QUESTION.question);
    panel.fromWebview({ type: "submit", selectedIndex: 0 });
    await waitFor(() => panel.feedback().length > 0, 1000, "wrong-answer feedback");
    panel.fromWebview({ type: "next_question" });
    await waitFor(() => panel.questions().length > 1, 3000, "follow-up question");
    assert.ok(generateRequests().length >= 2, "the follow-up did not ask the model");
    assert.match(generateRequests().at(-1)!.body, /Generate ONE multiple-choice/);
    panel.fromWebview({ type: "submit", selectedIndex: MCQ_QUESTION.correctIndex });
    assert.equal(await gate.promise, true);
  });

  test("the panel is open while the model is still writing, and Bypass ends the hold", async () => {
    server.handler = () => ({ kind: "hang" });
    setQuizActive(true);
    const gate = startGate(fakeContext());
    await waitFor(() => vscodeStub.panels.length > 0, 1000, "panel during generation");
    assert.equal(gate.settled(), false);
    assert.equal(requestQuizBypass(), true);
    assert.equal(await gate.promise, true);
    setQuizActive(false);
  });

  test("if the model cannot be reached, the written fallback opens", async () => {
    routeOllamaTo("http://127.0.0.1:" + (await closedPort()));
    const gate = startGate(fakeContext());
    const panel = await openPanel();
    assert.match(String(panel.questions()[0].questionText), /What does this code do\?/);
    panel.fromWebview({ type: "submit", answer: "x".repeat(15) });
    assert.equal(await gate.promise, true);
  });
});

describe("agent-edit quiz and the Bypass command", () => {
  test("agent quizzes never set quizActive, so the Bypass command cannot reach them", async () => {
    const { state, setBypassArmed } = await import("../../src/state");
    server.handler = () => ({ kind: "hang" });
    state.processing = true;
    const gate = startGate(fakeContext());
    await waitFor(() => generateRequests().length > 0, 1000, "model request");
    const reached = requestQuizBypass();
    if (!reached) {
      setBypassArmed(true);
    }
    assert.equal(reached, false);
    assert.equal(state.bypassArmed, true);
    server.releaseHung(ollamaReply(FREE_TEXT_QUESTION));
    const panel = await openPanel();
    assert.equal(gate.settled(), false);
    panel.dispose();
    assert.equal(await gate.promise, false);
    state.processing = false;
    setBypassArmed(false);
  });
});
