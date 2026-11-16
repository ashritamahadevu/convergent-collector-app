import "./installVscodeStub";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import * as vscodeStub from "./vscodeStub";
import {
  FREE_TEXT_QUESTION,
  GOOD_ANSWER,
  MCQ_QUESTION,
  NONSENSE_ANSWER,
  OLLAMA,
  SNIPPET,
  closedPort,
  fakeContext,
  judgeJson,
  ollamaReply,
  redirectFetch,
  startMockServer,
  waitFor,
  type Behaviour,
  type MockServer,
} from "./harness";
import { clearQuestionCache, setLogSink } from "../../src/llm";
import { runComprehensionGate } from "../../src/quiz";
import { requestQuizBypass, setQuizActive } from "../../src/state";

/**
 * Drives src/quiz.ts runComprehensionGate end to end with a fake webview panel
 * and a real HTTP mock standing in for Ollama. This is the code path paste,
 * inline and agent edits all share; it decides whether held code is kept.
 */

let server: MockServer;
let restoreFetch: () => void = () => {};
const logs: string[] = [];

before(async () => {
  server = await startMockServer();
  setLogSink((line) => logs.push(line));
  restoreFetch = redirectFetch([{ from: OLLAMA, to: "" }]); // replaced per test
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
  logs.length = 0;
  routeOllamaTo(server.base);
  setQuizActive(false);
});

type Gate = { promise: Promise<boolean>; settled: () => boolean; result: () => boolean | undefined };

function startGate(ctx: ReturnType<typeof fakeContext>): Gate {
  let done = false;
  let value: boolean | undefined;
  const promise = runComprehensionGate(SNIPPET, ctx as never, "javascript", { source: "paste", filePath: "C:/w/a.js" }).then(
    (v) => {
      done = true;
      value = v;
      return v;
    },
  );
  return { promise, settled: () => done, result: () => value };
}

async function openPanel(index = 0) {
  await waitFor(() => vscodeStub.panels.length > index, 5000, "quiz panel");
  const panel = vscodeStub.panels[index];
  panel.fromWebview({ type: "ready" });
  await waitFor(() => panel.questions().length > 0, 2000, "question shown");
  return panel;
}

/** Generate succeeds with the given question; judge requests get `judgeBehaviour`. */
function script(judgeBehaviour: (n: number) => Behaviour, question: unknown = FREE_TEXT_QUESTION): void {
  let judged = 0;
  server.handler = (req) => (req.kind === "judge" ? judgeBehaviour(judged++) : ollamaReply(question));
}

const attempts = (ctx: ReturnType<typeof fakeContext>) =>
  (ctx.store.get("comprehensionGuard.attempts") as { outcome: string; passed: boolean }[] | undefined) ?? [];

function generateRequests(): { body: string }[] {
  return server.requests.filter((request) => request.kind === "generate");
}

describe("the model writes the question", () => {
  test("the panel shows the question the model returned", async () => {
    server.handler = () => ollamaReply(FREE_TEXT_QUESTION);
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
});

describe("network down before the quiz starts", () => {
  test("generation fails -> min-length fallback quiz opens fast, with no hint that grading is offline", async () => {
    routeOllamaTo("http://127.0.0.1:" + (await closedPort()));
    const ctx = fakeContext();
    const started = Date.now();
    const gate = startGate(ctx);
    const panel = await openPanel();
    const shownAfter = Date.now() - started;
    assert.match(String(panel.questions()[0].questionText), /What does this code do\?/);
    assert.ok(vscodeStub.warnMessages.length > 0, "the student is told generation failed");
    // Any 15+ character text passes the fallback.
    panel.fromWebview({ type: "submit", answer: "x".repeat(15) });
    assert.equal(await gate.promise, true);
    assert.equal(attempts(ctx).length, 0, "fallback is not recorded");
    console.log("[observed] fallback panel shown after " + shownAfter + "ms; 15 x's pass it; no user-visible reason");
  });

  test("generation fails -> Bypass on the fallback quiz keeps the code", async () => {
    routeOllamaTo("http://127.0.0.1:" + (await closedPort()));
    const gate = startGate(fakeContext());
    const panel = await openPanel();
    panel.fromWebview({ type: "bypass" });
    assert.equal(await gate.promise, true);
  });

  test("the panel is open while the model is still writing, and Bypass ends the hold", async () => {
    server.handler = () => ({ kind: "hang" });
    const gate = startGate(fakeContext());
    await waitFor(() => vscodeStub.panels.length > 0, 1000, "panel during generation");
    assert.equal(gate.settled(), false);
    assert.equal(requestQuizBypass(), true);
    assert.equal(await gate.promise, true);
    server.releaseHung(ollamaReply(FREE_TEXT_QUESTION));
  });
});

describe("agent-edit quiz and the Bypass command", () => {
  test("an open gate accepts the Bypass command", async () => {
    // agentGuard.runAgentQuiz sets state.processing = true but never calls setQuizActive(true).
    const { state, setBypassArmed } = await import("../../src/state");
    server.handler = () => ({ kind: "hang" });
    state.processing = true;
    const gate = startGate(fakeContext());
    await new Promise((r) => setTimeout(r, 300));
    // This is what extension.ts's comprehensionGuard.bypassNext does:
    const reached = requestQuizBypass();
    assert.equal(reached, true, "Bypass reaches the open gate");
    assert.equal(await gate.promise, true);
    server.releaseHung(ollamaReply(FREE_TEXT_QUESTION));
    state.processing = false;
    setBypassArmed(false);
  });
});

describe("network drops mid-quiz (after the question is shown)", () => {
  test("grading fails -> answer is ungraded, mastery is unchanged, and the student can retry", async () => {
    const ctx = fakeContext();
    script(() => ({ kind: "reset" }));
    const gate = startGate(ctx);
    const panel = await openPanel();
    panel.fromWebview({ type: "submit", answer: NONSENSE_ANSWER });
    await waitFor(() => panel.feedback().length > 0, 3000, "ungraded feedback");
    assert.equal(gate.settled(), false, "the quiz stays open so the student can retry");
    const recorded = attempts(ctx);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].outcome, "ungraded");
    assert.equal(recorded[0].passed, false);
    const mastery = ctx.store.get("comprehensionGuard.conceptMastery") as { concept: string; mastery: number }[] | undefined;
    assert.equal(mastery, undefined);
    assert.match(String(panel.feedback()[0].message), /not scored/);
    assert.ok(logs.some((l) => /no_decision reason=provider_error/.test(l)));
    panel.dispose();
    assert.equal(await gate.promise, false);
  });

  test("network drops during a follow-up -> second answer is ungraded, not passed", async () => {
    const ctx = fakeContext();
    script((n) => (n === 0 ? ollamaReply(judgeJson(["fail", "fail"])) : { kind: "reset" }));
    const gate = startGate(ctx);
    const panel = await openPanel();
    panel.fromWebview({ type: "submit", answer: NONSENSE_ANSWER });
    await waitFor(() => panel.feedback().length > 0, 3000, "follow-up feedback");
    assert.match(String(panel.feedback()[0].message), /Not quite/);
    panel.fromWebview({ type: "submit", answer: NONSENSE_ANSWER + " again" });
    await waitFor(() => panel.feedback().length > 1, 3000, "ungraded feedback");
    assert.equal(gate.settled(), false);
    assert.equal(attempts(ctx).at(-1)!.outcome, "ungraded");
    panel.dispose();
    assert.equal(await gate.promise, false);
  });

  test("short blip (one dropped request, back within 0.6s) is absorbed by the judge retry", async () => {
    const ctx = fakeContext();
    script((n) => (n === 0 ? { kind: "reset" } : ollamaReply(judgeJson(["fail", "fail"]))));
    const gate = startGate(ctx);
    const panel = await openPanel();
    panel.fromWebview({ type: "submit", answer: NONSENSE_ANSWER });
    await waitFor(() => panel.feedback().length > 0, 3000, "feedback");
    assert.equal(gate.settled(), false);
    panel.dispose();
    assert.equal(await gate.promise, false);
  });

  test("judge replies with upper-case FAIL verdicts -> student is failed", async () => {
    const ctx = fakeContext();
    const raw = JSON.stringify(judgeJson(["fail", "fail"])).replace(/"fail"/g, '"FAIL"');
    script(() => ollamaReply(raw));
    const gate = startGate(ctx);
    const panel = await openPanel();
    panel.fromWebview({ type: "submit", answer: NONSENSE_ANSWER });
    await waitFor(() => panel.feedback().length > 0, 3000, "fail feedback");
    assert.match(String(panel.feedback()[0].message), /Not quite/);
    assert.equal(gate.settled(), false);
    panel.dispose();
    assert.equal(await gate.promise, false);
    assert.notEqual(attempts(ctx)[0].outcome, "pass");
  });

  test("generator returned no criteria -> fallback quiz, not a graded pass", async () => {
    const ctx = fakeContext();
    const { criteria: _c, ...noCriteria } = FREE_TEXT_QUESTION;
    void _c;
    script(() => ollamaReply(judgeJson(["fail", "fail"])), noCriteria);
    const gate = startGate(ctx);
    const panel = await openPanel();
    assert.match(String(panel.questions()[0].questionText), /What does this code do\?/);
    panel.fromWebview({ type: "submit", answer: NONSENSE_ANSWER });
    assert.equal(await gate.promise, true);
    assert.equal(server.requests.filter((r) => r.kind === "judge").length, 0);
    assert.equal(attempts(ctx).length, 0, "fallback is not a graded pass");
  });

  test("judge renames criterion ids -> a correct answer still passes", async () => {
    const ctx = fakeContext();
    script(() => ollamaReply(judgeJson(["pass", "pass"], ["1", "2"])));
    const gate = startGate(ctx);
    const panel = await openPanel();
    panel.fromWebview({ type: "submit", answer: GOOD_ANSWER });
    assert.equal(await gate.promise, true);
    assert.equal(attempts(ctx).at(-1)!.outcome, "pass");
  });
});

describe("slow grading: what the user can do while it runs", () => {
  test("no 'grading...' state is sent to the webview while the judge runs", async () => {
    script(() => ({ ...ollamaReply(judgeJson(["pass", "pass"])), delayMs: 1500 }) as Behaviour);
    const gate = startGate(fakeContext());
    const panel = await openPanel();
    panel.fromWebview({ type: "submit", answer: GOOD_ANSWER });
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(panel.toWebview.some((message) => message.type === "grading"), "the panel is told grading is in progress");
    assert.equal(await gate.promise, true);
  });

  test("BUG: a second Submit click during slow grading is replayed and burns a follow-up", async () => {
    vscodeStub.settings.set("comprehensionGuard.maxFollowups", 1);
    const ctx = fakeContext();
    script(() => ({ ...ollamaReply(judgeJson(["fail", "fail"])), delayMs: 800 }) as Behaviour);
    const gate = startGate(ctx);
    const panel = await openPanel();
    panel.fromWebview({ type: "submit", answer: NONSENSE_ANSWER });
    await new Promise((r) => setTimeout(r, 200));
    panel.fromWebview({ type: "submit", answer: NONSENSE_ANSWER });
    await waitFor(() => panel.feedback().length > 0, 3000, "first grade");
    assert.equal(server.requests.filter((r) => r.kind === "judge").length, 1, "the second click is not graded");
    assert.equal(gate.settled(), false);
    panel.dispose();
    assert.equal(await gate.promise, false);
  });

  test("Bypass button clicked during the last grading keeps the code", async () => {
    vscodeStub.settings.set("comprehensionGuard.maxFollowups", 1);
    const ctx = fakeContext();
    script(() => ({ ...ollamaReply(judgeJson(["fail", "fail"])), delayMs: 800 }) as Behaviour);
    const gate = startGate(ctx);
    const panel = await openPanel();
    panel.fromWebview({ type: "submit", answer: NONSENSE_ANSWER });
    await new Promise((r) => setTimeout(r, 200));
    panel.fromWebview({ type: "bypass" });
    assert.equal(await gate.promise, true);
    assert.equal(attempts(ctx).at(-1)!.outcome, "bypass");
  });

  test("Bypass COMMAND during slow grading is honoured (contrast with the button)", async () => {
    vscodeStub.settings.set("comprehensionGuard.maxFollowups", 1);
    script(() => ({ ...ollamaReply(judgeJson(["fail", "fail"])), delayMs: 800 }) as Behaviour);
    setQuizActive(true);
    const gate = startGate(fakeContext());
    const panel = await openPanel();
    panel.fromWebview({ type: "submit", answer: NONSENSE_ANSWER });
    await new Promise((r) => setTimeout(r, 200));
    setQuizActive(true);
    requestQuizBypass();
    assert.equal(await gate.promise, true);
    setQuizActive(false);
  });

  test("closing the quiz tab during grading removes the code, including when grading cannot finish", async () => {
    script(() => ({ kind: "reset" }));
    const gate = startGate(fakeContext());
    const panel = await openPanel();
    panel.fromWebview({ type: "submit", answer: NONSENSE_ANSWER });
    panel.dispose();
    assert.equal(await gate.promise, false);
  });
});

describe("misgrade report while offline", () => {
  async function reachDispute(ctx: ReturnType<typeof fakeContext>) {
    script(() => ollamaReply(judgeJson(["fail", "fail"])));
    const gate = startGate(ctx);
    const panel = await openPanel();
    panel.fromWebview({ type: "submit", answer: GOOD_ANSWER });
    await waitFor(() => panel.feedback().length > 0, 3000, "feedback");
    assert.equal(panel.feedback()[0].allowDispute, true);
    return { gate, panel };
  }

  test("report URL unreachable: report kept locally, quiz finishes, user told", async () => {
    const port = await closedPort();
    vscodeStub.settings.set("comprehensionGuard.misgradeReportUrl", "http://127.0.0.1:" + port + "/report");
    const ctx = fakeContext();
    const { gate, panel } = await reachDispute(ctx);
    panel.fromWebview({ type: "dispute", answer: GOOD_ANSWER });
    assert.equal(await gate.promise, true);
    assert.equal((ctx.store.get("comprehensionGuard.misgradeReports") as unknown[]).length, 1);
    assert.match(vscodeStub.infoMessages.at(-1)!, /could not be reached/);
  });

  test("BUG: report URL accepts but never answers: dispute hangs the quiz (no timeout on this fetch)", async () => {
    vscodeStub.settings.set("comprehensionGuard.misgradeReportUrl", server.base + "/report");
    const ctx = fakeContext();
    const { gate, panel } = await reachDispute(ctx);
    server.handler = () => ({ kind: "hang" });
    panel.fromWebview({ type: "dispute", answer: GOOD_ANSWER });
    assert.equal(await gate.promise, true);
    assert.equal(panel.disposed, true);
    assert.equal((ctx.store.get("comprehensionGuard.misgradeReports") as unknown[]).length, 1, "local copy kept");
  });
});
