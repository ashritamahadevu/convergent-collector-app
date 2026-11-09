import "./installVscodeStub";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import * as vscodeStub from "./vscodeStub";
import {
  FREE_TEXT_QUESTION,
  GOOD_ANSWER,
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
import { setLogSink } from "../../src/llm";
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

describe("network down before the quiz starts", () => {
  test("generation fails -> min-length fallback quiz opens fast, with no hint that grading is offline", async () => {
    routeOllamaTo("http://127.0.0.1:" + (await closedPort()));
    const ctx = fakeContext();
    const started = Date.now();
    const gate = startGate(ctx);
    const panel = await openPanel();
    const shownAfter = Date.now() - started;
    assert.match(String(panel.questions()[0].questionText), /What does this code do\?/);
    assert.equal(vscodeStub.infoMessages.length + vscodeStub.warnMessages.length + vscodeStub.errorMessages.length, 0);
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

  test("generation hangs: no panel exists, so nothing can be clicked; Bypass command is deferred until the panel opens AND the user acts", async () => {
    server.handler = () => ({ kind: "hang" });
    setQuizActive(true); // what pasteGuard / editGuard do before calling the gate
    const gate = startGate(fakeContext());
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(vscodeStub.panels.length, 0, "no quiz UI during generation");
    assert.equal(requestQuizBypass(), true, "command reports success");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(gate.settled(), false, "BUG: bypass does not end the hold while generation is pending");
    // Network comes back: the question arrives.
    server.releaseHung(ollamaReply(FREE_TEXT_QUESTION));
    const panel = await openPanel();
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(gate.settled(), false, "BUG: quiz opens and waits even though Bypass was requested");
    panel.dispose();
    assert.equal(await gate.promise, true, "closing now counts as the earlier bypass");
    setQuizActive(false);
  });
});

describe("agent-edit quiz and the Bypass command", () => {
  test("BUG: agent quizzes never set quizActive, so the Bypass command cannot reach them (it arms a bypass for the NEXT insertion instead)", async () => {
    // agentGuard.runAgentQuiz sets state.processing = true but never calls setQuizActive(true).
    const { state, setBypassArmed } = await import("../../src/state");
    server.handler = () => ({ kind: "hang" });
    state.processing = true;
    const gate = startGate(fakeContext());
    await new Promise((r) => setTimeout(r, 300));
    // This is what extension.ts's comprehensionGuard.bypassNext does:
    const reached = requestQuizBypass();
    if (!reached) {
      setBypassArmed(true);
    }
    assert.equal(reached, false, "Bypass did not reach the open agent quiz");
    assert.equal(state.bypassArmed, true, "a one-shot bypass is now armed for an unrelated future insertion");
    server.releaseHung(ollamaReply(FREE_TEXT_QUESTION));
    const panel = await openPanel();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(gate.settled(), false);
    panel.dispose(); // closing = remove the agent's code
    assert.equal(await gate.promise, false, "agent code discarded although the user ran Bypass");
    state.processing = false;
    setBypassArmed(false);
  });
});

describe("network drops mid-quiz (after the question is shown)", () => {
  test("BUG: grading fails -> nonsense answer is passed and recorded as a real pass (mastery raised)", async () => {
    const ctx = fakeContext();
    script(() => ({ kind: "reset" }));
    const gate = startGate(ctx);
    const panel = await openPanel();
    panel.fromWebview({ type: "submit", answer: NONSENSE_ANSWER });
    assert.equal(await gate.promise, true);
    const recorded = attempts(ctx);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].outcome, "pass");
    assert.equal(recorded[0].passed, true);
    const mastery = ctx.store.get("comprehensionGuard.conceptMastery") as { concept: string; mastery: number }[];
    assert.ok(mastery?.length > 0, "mastery updated from an ungraded answer");
    assert.equal(panel.feedback().length, 0, "user is not told grading was skipped");
    assert.ok(logs.some((l) => /no_decision reason=provider_error/.test(l)));
    console.log("[observed] offline grading -> pass, mastery " + JSON.stringify(mastery));
  });

  test("BUG: network drops during a follow-up -> second (nonsense) answer is passed", async () => {
    const ctx = fakeContext();
    script((n) => (n === 0 ? ollamaReply(judgeJson(["fail", "fail"])) : { kind: "reset" }));
    const gate = startGate(ctx);
    const panel = await openPanel();
    panel.fromWebview({ type: "submit", answer: NONSENSE_ANSWER });
    await waitFor(() => panel.feedback().length > 0, 3000, "follow-up feedback");
    assert.match(String(panel.feedback()[0].message), /Not quite/);
    panel.fromWebview({ type: "submit", answer: NONSENSE_ANSWER + " again" });
    assert.equal(await gate.promise, true);
    assert.equal(attempts(ctx).at(-1)!.outcome, "pass");
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

  test("BUG: judge replies with upper-case FAIL verdicts -> student is passed", async () => {
    const ctx = fakeContext();
    const raw = JSON.stringify(judgeJson(["fail", "fail"])).replace(/"fail"/g, '"FAIL"');
    script(() => ollamaReply(raw));
    const gate = startGate(ctx);
    const panel = await openPanel();
    panel.fromWebview({ type: "submit", answer: NONSENSE_ANSWER });
    assert.equal(await gate.promise, true);
    assert.equal(attempts(ctx)[0].outcome, "pass");
  });

  test("BUG: generator returned no criteria -> any 15+ char answer passes (judge never called)", async () => {
    const ctx = fakeContext();
    const { criteria: _c, ...noCriteria } = FREE_TEXT_QUESTION;
    void _c;
    script(() => ollamaReply(judgeJson(["fail", "fail"])), noCriteria);
    const gate = startGate(ctx);
    const panel = await openPanel();
    panel.fromWebview({ type: "submit", answer: NONSENSE_ANSWER });
    assert.equal(await gate.promise, true);
    assert.equal(server.requests.filter((r) => r.kind === "judge").length, 0);
    assert.equal(attempts(ctx)[0].outcome, "pass");
  });

  test("BUG: judge renames criterion ids -> a correct answer is failed every time and the code is removed", async () => {
    const ctx = fakeContext();
    script(() => ollamaReply(judgeJson(["pass", "pass"], ["1", "2"])));
    const gate = startGate(ctx);
    const panel = await openPanel();
    for (let i = 0; i < 3; i++) {
      panel.fromWebview({ type: "submit", answer: GOOD_ANSWER });
      if (i < 2) {
        await waitFor(() => panel.feedback().length > i, 3000, "feedback " + i);
      }
    }
    assert.equal(await gate.promise, false);
    assert.equal(attempts(ctx).at(-1)!.outcome, "fail");
  });
});

describe("slow grading: what the user can do while it runs", () => {
  test("no 'grading...' state is sent to the webview while the judge runs", async () => {
    script(() => ({ ...ollamaReply(judgeJson(["pass", "pass"])), delayMs: 1500 }) as Behaviour);
    const gate = startGate(fakeContext());
    const panel = await openPanel();
    const before = panel.toWebview.length;
    panel.fromWebview({ type: "submit", answer: GOOD_ANSWER });
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal(panel.toWebview.length, before, "nothing posted to the webview during grading");
    assert.equal(await gate.promise, true);
  });

  test("BUG: a second Submit click during slow grading is replayed and burns a follow-up", async () => {
    vscodeStub.settings.set("comprehensionGuard.maxFollowups", 2);
    const ctx = fakeContext();
    script(() => ({ ...ollamaReply(judgeJson(["fail", "fail"])), delayMs: 800 }) as Behaviour);
    const gate = startGate(ctx);
    const panel = await openPanel();
    panel.fromWebview({ type: "submit", answer: NONSENSE_ANSWER });
    await new Promise((r) => setTimeout(r, 200));
    panel.fromWebview({ type: "submit", answer: NONSENSE_ANSWER }); // impatient second click
    const result = await gate.promise;
    assert.equal(result, false, "failed after one deliberate answer");
    assert.equal(server.requests.filter((r) => r.kind === "judge").length, 2);
    assert.equal(panel.feedback().length, 1, "the follow-up was shown but never answered by the user");
  });

  test("BUG: Bypass button clicked during the last grading is ignored when that grade is a fail -> code removed", async () => {
    vscodeStub.settings.set("comprehensionGuard.maxFollowups", 1);
    const ctx = fakeContext();
    script(() => ({ ...ollamaReply(judgeJson(["fail", "fail"])), delayMs: 800 }) as Behaviour);
    const gate = startGate(ctx);
    const panel = await openPanel();
    panel.fromWebview({ type: "submit", answer: NONSENSE_ANSWER });
    await new Promise((r) => setTimeout(r, 200));
    panel.fromWebview({ type: "bypass" });
    assert.equal(await gate.promise, false, "Bypass was clicked but the gate returned false");
    assert.equal(attempts(ctx).at(-1)!.outcome, "fail");
  });

  test("Bypass COMMAND during slow grading is honoured (contrast with the button)", async () => {
    vscodeStub.settings.set("comprehensionGuard.maxFollowups", 1);
    script(() => ({ ...ollamaReply(judgeJson(["fail", "fail"])), delayMs: 800 }) as Behaviour);
    setQuizActive(true);
    const gate = startGate(fakeContext());
    const panel = await openPanel();
    panel.fromWebview({ type: "submit", answer: NONSENSE_ANSWER });
    await new Promise((r) => setTimeout(r, 200));
    requestQuizBypass();
    assert.equal(await gate.promise, true);
    setQuizActive(false);
  });

  test("closing the quiz tab during grading still keeps the code if grading then fails over (no_decision)", async () => {
    script(() => ({ kind: "reset" }));
    const gate = startGate(fakeContext());
    const panel = await openPanel();
    panel.fromWebview({ type: "submit", answer: NONSENSE_ANSWER });
    panel.dispose(); // user closes the tab, which is documented to remove the code
    assert.equal(await gate.promise, true, "code kept although the tab was closed");
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
    await new Promise((r) => setTimeout(r, 3000));
    assert.equal(gate.settled(), false, "still waiting on the report POST after 3s");
    assert.equal(panel.disposed, false, "quiz still open, file still locked");
    server.releaseHung({ kind: "json", body: {} });
    assert.equal(await gate.promise, true);
    assert.equal((ctx.store.get("comprehensionGuard.misgradeReports") as unknown[]).length, 1, "local copy kept");
  });
});
