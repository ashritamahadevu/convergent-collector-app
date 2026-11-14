import * as vscode from "vscode";
import { aggregate, gradeMcq, gradeOrdering, runPreChecks } from "./decision";
import { generateQuestion, getJudgeConfigId, judge, providerNeedsApiKey } from "./llm";
import { getApiKey } from "./secrets";
import {
  getGradingMode,
  getMaxFollowups,
  getMinAnswerLength,
  getNonCriticalPassFraction,
  getProvider,
  insertedRange,
  setQuizActive,
  state,
  subscribeQuizBypass,
  takeQuizBypass,
} from "./state";
import { gradedScore, logReview, misconceptionsFor, rememberCheck } from "./memory/remember";
import { addAttempt, saveMisgradeReport } from "./store";
import type { AttemptOutcome, AttemptRecord, AttemptSource, CriterionVerdict, GeneratedQuestion } from "./types";
import { sameCode } from "./debugCode";
import type { DocumentLock } from "./documentLock";
import { createQuizPanel, type QuizAction } from "./quizPanel";
import { newDashboardCheckId, recordDashboardCheck } from "./dashboard/service";

let missingApiKeyHintShown = false;

type GateMeta = {
  source?: AttemptSource;
  filePath?: string;
  recall?: boolean;
  editor?: vscode.TextEditor;
  range?: vscode.Range;
  lock?: DocumentLock;
};

type DebugPlant = {
  editor: vscode.TextEditor;
  range: vscode.Range;
  original: string;
  dispose: () => void;
};

/**
 * Runs the comprehension check for a snippet of code.
 *
 * With extension context and a configured API key, uses LLM-generated questions
 * in a webview (prechecks, judge, follow-ups). Without context or key, falls
 * back to the deterministic min-length input box gate.
 */
export async function runComprehensionGate(
  snippet: string,
  context?: vscode.ExtensionContext,
  language?: string,
  meta?: GateMeta,
): Promise<boolean> {
  const owned = !state.quizActive;
  if (owned) {
    setQuizActive(true);
  }
  try {
    return await runComprehensionGateBody(snippet, context, language, meta);
  } finally {
    if (owned) {
      setQuizActive(false);
    }
  }
}

async function runComprehensionGateBody(
  snippet: string,
  context?: vscode.ExtensionContext,
  language?: string,
  meta?: GateMeta,
): Promise<boolean> {
  if (!context) {
    return fallbackGate(snippet, language);
  }

  const provider = getProvider();
  const key = providerNeedsApiKey(provider) ? await getApiKey(context, provider) : "local";
  if (!key?.trim()) {
    if (!missingApiKeyHintShown) {
      missingApiKeyHintShown = true;
      void vscode.window.showInformationMessage(
        "Comprehension Guard: set an API key to enable LLM grading (command: Comprehension Guard: Set API Key).",
      );
    }
    return fallbackGate(snippet, language, context.extensionUri);
  }

  const mode = getGradingMode();
  const lang = language ?? "";

  void vscode.window.setStatusBarMessage("Comprehension Guard: preparing a question. Bypass keeps the code.", 4000);
  let stopped: "bypass" | "cancel" | undefined;
  const stopBypass = subscribeQuizBypass(() => {
    stopped = "bypass";
  });
  let question: GeneratedQuestion;
  let timer: ReturnType<typeof setInterval> | undefined;
  let cap: ReturnType<typeof setTimeout> | undefined;
  try {
    question = await Promise.race([
      generateQuestion({
        context,
        snippet,
        language: lang,
        mode,
      }),
      new Promise<GeneratedQuestion>((_, reject) => {
        timer = setInterval(() => {
          if (stopped) {
            reject(new Error(stopped));
          }
        }, 50);
        cap = setTimeout(() => reject(new Error("timeout")), 45_000);
      }),
    ]);
  } catch (err) {
    if (timer) clearInterval(timer);
    if (cap) clearTimeout(cap);
    stopBypass();
    const reason = err instanceof Error ? err.message : "";
    if (reason === "bypass" || stopped === "bypass") {
      return true;
    }
    if (reason === "cancel" || stopped === "cancel") {
      return false;
    }
    void vscode.window.showWarningMessage(
      "Comprehension Guard: could not generate a question (" + reason.slice(0, 120) + "). A short explanation check is open instead.",
    );
    return fallbackGate(snippet, language, context.extensionUri);
  }
  if (timer) clearInterval(timer);
  if (cap) clearTimeout(cap);
  stopBypass();

  const view = createQuizPanel(snippet, lang, context.extensionUri);
  view.showQuestion(question);
  const debug = question.kind === "debug"
    ? await beginDebug(meta, snippet, question.buggyCode ?? "")
    : undefined;

  /* Highlight the pasted lines in the active editor for the duration of the quiz */
  let pasteDecoration: vscode.TextEditorDecorationType | undefined;
  if (meta?.editor && meta?.range && question.kind !== "debug") {
    pasteDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor("diffEditor.insertedTextBackground"),
      borderColor: new vscode.ThemeColor("diffEditor.insertedTextBorder"),
      overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.addedForeground"),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });
    meta.editor.setDecorations(pasteDecoration, [meta.range]);
  }

  let followups = 0;
  const maxFollowups = getMaxFollowups();
  const judgeConfigId = getJudgeConfigId();

  let lastStudentAnswer = "";
  let lastFeedback = "";
  let lastMisconception = "";
  let lastCriterionResults: AttemptRecord["criterionResults"];
  let dashboardCheckId = newDashboardCheckId();
  let assessed = false;
  let lastScoreOverride: number | undefined;
  const resetDashboardQuestion = () => {
    dashboardCheckId = newDashboardCheckId();
    assessed = false;
    lastStudentAnswer = ""; lastFeedback = ""; lastMisconception = "";
    lastCriterionResults = undefined;
    lastScoreOverride = undefined;
  };

  const recordAttempt = async (
    passed: boolean,
    outcome: AttemptOutcome,
    criterionResults?: AttemptRecord["criterionResults"],
    scoreOverride?: number,
  ): Promise<void> => {
    const draft: AttemptRecord = {
      timestamp: Date.now(),
      language: lang,
      charCount: snippet.length,
      mode,
      conceptTags: question.conceptTags,
      criterionResults,
      passed,
      outcome,
      followups,
      judgeConfigId,
      appealed: outcome === "disputed",
      source: meta?.source,
      filePath: meta?.filePath,
      misconceptions: misconceptionsFor({ mode, passed, criterionResults }),
    };
    draft.score = outcome === "ungraded" ? undefined : scoreOverride ?? gradedScore(draft);
    await addAttempt(context, draft);
    let masteryAfter: number | undefined;
    if (outcome === "pass" || outcome === "fail" || outcome === "disputed") {
      masteryAfter = await rememberCheck(context, draft);
    }
    const ungraded = outcome === "ungraded";
    await logReview(context, {
      concepts: draft.conceptTags,
      eventKind: outcome === "bypass" ? "bypass" : outcome === "explained" ? "explain" : meta?.recall ? "recall" : "check",
      source: draft.source,
      mode: draft.mode,
      score: outcome === "bypass" || ungraded ? undefined : draft.score,
      passed: outcome === "bypass" || outcome === "explained" || ungraded ? undefined : draft.passed,
      followups: draft.followups,
      masteryAfter,
      filePath: draft.filePath,
      question: question.question,
      studentAnswer: lastStudentAnswer,
      misconception: outcome === "fail" ? lastMisconception : "",
      askedForExplanation: outcome === "explained",
      explanation: outcome === "explained" ? question.referenceAnswer : "",
      judgeConfigId: draft.judgeConfigId,
    });
    const applicable = (criterionResults ?? []).filter(c => c.verdict !== "n/a");
    const displayScore = !assessed || ungraded || !["pass", "fail"].includes(outcome) ? null
      : scoreOverride ?? (applicable.length ? applicable.filter(c => c.verdict === "pass").length / applicable.length : passed ? 1 : 0);
    await recordDashboardCheck(context, {
      eventId: dashboardCheckId, timestamp: draft.timestamp, filePath: meta?.filePath,
      check: {
        concepts: question.conceptTags, question: question.question, answer: lastStudentAnswer,
        feedback: ungraded ? "Grader could not decide." : outcome === "explained" ? "Explanation requested." : outcome === "pass" ? "Correct." : lastFeedback,
        misconception: outcome === "fail" ? lastMisconception : "",
        outcome: ungraded || (!assessed && outcome === "fail") ? "ungraded" : outcome, score: displayScore,
        source: meta?.source ?? "unknown", mode: question.kind, filePath: null, retries: followups,
      },
    });
    if (ungraded) {
      dashboardCheckId = newDashboardCheckId();
      assessed = false; lastScoreOverride = undefined; lastCriterionResults = undefined;
    }
  };

  if (question.kind === "debug" && !debug) {
    view.showFeedback({ message: "Could not place the buggy code in the editor." });
    await recordAttempt(false, "fail");
    view.close();
    return false;
  }
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const payload = await waitForQuizAction(view);

      if (payload.type === "explain") {
        await restoreDebug(debug);
        followups += 1;
        const explanation = question.referenceAnswer.trim();
        view.showFeedback({
          message: explanation
            ? "Explanation: " + explanation
            : "No explanation was generated for this check. The code stays.",
          explained: true,
          allowNextQuestion: followups < maxFollowups,
        });
        await recordAttempt(false, "explained");
        vscode.window.setStatusBarMessage(
          "Comprehension Guard: explanation shown. The code stays and is not counted as correct.",
          5000,
        );
        const nextAction = await view.waitForSubmit();
        if (nextAction.type === "next_question" && followups < maxFollowups) {
          try {
            question = await generateQuestion({ context, snippet, language: lang, mode, kind: "multiple-choice" });
            resetDashboardQuestion();
          } catch {
            view.showFeedback({
              message: "Could not generate a follow-up question. Please close the panel.",
            });
            await view.waitForSubmit();
            view.close();
            return true;
          }
          view.showQuestion(question);
          continue;
        }
        view.close();
        return true;
      }

      if (payload.type === "bypass") {
        await restoreDebug(debug);
        await recordAttempt(false, "bypass");
        view.close();
        vscode.window.setStatusBarMessage(
          "Comprehension Guard: bypassed. The code stays and is not counted as correct.",
          4000,
        );
        return true;
      }

      if (payload.type === "dispute") {
        const reported = await saveMisgradeReport(context, {
          timestamp: Date.now(),
          language: lang,
          question: question.question,
          studentAnswer: payload.answer?.trim() || lastStudentAnswer,
          feedback: lastFeedback,
          snippetPreview: snippet.slice(0, 2000),
          conceptTags: question.conceptTags,
          judgeConfigId,
        });
        await recordAttempt(true, "disputed", lastCriterionResults);
        view.close();
        vscode.window.showInformationMessage(
          "Comprehension Guard: counted as correct. " + reported.detail,
        );
        return true;
      }

      if (payload.type === "cancel") {
        await restoreDebug(debug);
        await recordAttempt(false, "fail");
        view.close();
        vscode.window.setStatusBarMessage(
          "Comprehension Guard: quiz closed. The code was removed.",
          4000,
        );
        return false;
      }

      if (payload.type === "next_question") {
        /* User clicked "Next Question" after a wrong answer.  Generate a fresh
           follow-up question and show it.  followups was already incremented
           when the wrong answer was detected, so we don't touch it here. */
        if (followups >= maxFollowups) {
          await recordAttempt(false, "fail");
          view.close();
          return false;
        }
        let replacement: GeneratedQuestion;
        try {
          replacement = await generateQuestion({ context, snippet, language: lang, mode, kind: "multiple-choice" });
        } catch {
          // Only a generation failure stays on this question. Recording or restoring
          // the editor must not be reported as a failed follow-up, or the same event
          // id would be finalized again on the next attempt.
          view.showFeedback({
            message: "Could not generate a follow-up question. Please try explaining the code or close the panel.",
          });
          continue;
        }
        if (assessed) await recordAttempt(false, "fail", lastCriterionResults, lastScoreOverride);
        if (question.kind === "debug") {
          await restoreDebug(debug);
          meta?.lock?.resume();
        }
        question = replacement;
        resetDashboardQuestion();
        view.showQuestion(question);
        continue;
      }

      lastStudentAnswer = (payload.answer ?? "").trim();

      if (question.kind === "debug" && debug) {
        assessed = true;
        const actual = debug.editor.document.getText(debug.range);
        lastScoreOverride = sameCode(actual, snippet) ? 1 : 0;
        if (sameCode(actual, snippet)) {
          debug.dispose();
          meta?.lock?.resume();
          await recordAttempt(true, "pass", undefined, 1);
          view.close();
          return true;
        }
        followups += 1;
        lastFeedback = "That is not the original behavior yet. Keep editing the code in the editor.";
        if (followups <= maxFollowups) {
          view.showFeedback({ message: lastFeedback, allowDispute: true, allowNextQuestion: followups < maxFollowups });
          continue;
        }
        await restoreDebug(debug);
        await recordAttempt(false, "fail", undefined, 0);
        view.close();
        return false;
      }

      if (question.kind === "multiple-choice") {
        const selectedIndex = payload.selectedIndex;
        if (selectedIndex === undefined) {
          view.showFeedback({ message: "Please select an option before submitting." });
          continue;
        }

        const ok = gradeMcq(question, selectedIndex);
        assessed = true;
        lastStudentAnswer = question.options?.[selectedIndex] ?? String(selectedIndex);
        if (ok) {
          await recordAttempt(true, "pass");
          view.showFeedback({ message: "Correct! The code has been accepted.", passed: true });
          await new Promise<void>((resolve) => setTimeout(resolve, 1200));
          view.close();
          return true;
        }

        followups += 1;
        lastFeedback = "That option is not correct. Look at the code again and try another.";

        if (followups <= maxFollowups) {
          view.showFeedback({
            message: lastFeedback,
            allowDispute: true,
            passed: false,
            allowNextQuestion: followups < maxFollowups,
            correctOption:
              typeof question.correctIndex === "number" && question.options
                ? question.options[question.correctIndex]
                : undefined,
          });
          continue;
        }

        await recordAttempt(false, "fail");
        view.close();
        return false;
      }

      if (question.kind === "ordering") {
        const order = payload.order ?? [];
        const score = gradeOrdering(question, order);
        lastScoreOverride = score;
        assessed = true;
        lastStudentAnswer = order.map(i => question.items?.[i] ?? String(i)).join(" → ");
        const ok = score >= 0.999;
        if (ok) {
          await recordAttempt(true, "pass", undefined, score);
          view.showFeedback({ message: "Correct! The code has been accepted.", passed: true });
          await new Promise<void>((resolve) => setTimeout(resolve, 1200));
          view.close();
          return true;
        }
        followups += 1;
        lastFeedback = "That order is not quite right. Move the steps and try again.";
        if (followups <= maxFollowups) {
          view.showFeedback({ message: lastFeedback, allowDispute: true, passed: false, allowNextQuestion: followups < maxFollowups });
          continue;
        }
        await recordAttempt(false, "fail", undefined, score);
        view.close();
        return false;
      }

      const answer = (payload.answer ?? "").trim();
      const preChecks = runPreChecks(answer, snippet, getMinAnswerLength());
      const blocking = preChecks.filter((c) => c.blocking);
      if (blocking.length > 0) {
        view.showFeedback({ message: blocking.map((c) => c.message).join(" ") });
        continue;
      }

      view.beginGrade();
      const res = await judge({
        context,
        snippet,
        language: lang,
        question,
        studentAnswer: payload.answer ?? "",
      });
      view.endGrade();

      const interrupt = takeQuizBypass() ? "bypass" : view.pollInterrupt();
      if (interrupt === "bypass") {
        await recordAttempt(false, "bypass");
        view.close();
        vscode.window.setStatusBarMessage(
          "Comprehension Guard: bypassed. The code stays and is not counted as correct.",
          4000,
        );
        return true;
      }
      if (interrupt === "cancel") {
        await recordAttempt(false, "fail");
        view.close();
        vscode.window.setStatusBarMessage(
          "Comprehension Guard: quiz closed. The code was removed.",
          4000,
        );
        return false;
      }

      if (res.kind === "decided") {
        lastMisconception = res.misconception ?? "";
      }

      if (res.kind === "no_decision") {
        await recordAttempt(false, "ungraded");
        view.showFeedback({
          message: "Grading failed, so this answer was not scored. Try again, or bypass.",
          passed: false,
          allowDispute: false,
          allowNextQuestion: false,
        });
        continue;
      }

      const agg = aggregate(
        question.criteria,
        res.verdicts,
        getNonCriticalPassFraction(),
      );

      const criterionResults = mapCriterionResults(res.verdicts);
      assessed = true;
      lastCriterionResults = criterionResults;

      if (agg.outcome === "pass") {
        await recordAttempt(true, "pass", criterionResults);
        view.showFeedback({ message: "Correct! The code has been accepted.", passed: true });
        await new Promise<void>((resolve) => setTimeout(resolve, 1200));
        view.close();
        return true;
      }

      followups += 1;
      lastFeedback =
        "Not quite. Look at the part of the code the question asks about and describe what it does. The answer is not shown.";

      if (followups <= maxFollowups) {
        view.showFeedback({
          message: lastFeedback,
          allowDispute: true,
          passed: false,
          allowNextQuestion: followups < maxFollowups,
        });
        continue;
      }

      await recordAttempt(false, "fail", criterionResults);
      view.close();
      return false;
    }
  } finally {
    /* Dispose here — and ONLY here — so the green decoration persists across all
       question/feedback cycles and is removed exactly once when the quiz ends. */
    pasteDecoration?.dispose();
  }
}

/** Submit, close the quiz tab, or Bypass. Bypass keeps the code; closing removes it. */
async function waitForQuizAction(
  view: ReturnType<typeof createQuizPanel>,
): Promise<QuizAction> {
  let bypassed = false;
  const unsubscribe = subscribeQuizBypass(() => {
    bypassed = true;
    view.close();
  });
  try {
    const payload = await view.waitForSubmit();
    if (bypassed || takeQuizBypass()) {
      return { type: "bypass" };
    }
    return payload;
  } finally {
    unsubscribe();
  }
}

export async function runSession(
  context: vscode.ExtensionContext,
  input: {
    snippet: string;
    filePath?: string;
    language?: string;
    questions: GeneratedQuestion[];
    source?: AttemptSource;
  },
): Promise<boolean> {
  if (input.questions.length === 0) {
    return false;
  }
  const view = createQuizPanel(input.snippet, input.language ?? "", context.extensionUri);
  let failed = false;
  for (const question of input.questions) {
    const checkId = newDashboardCheckId();
    const saveDashboard = (outcome: import("./dashboard/protocol").CheckOutcome, score: number | null,
      answer = "", feedback = "", misconception = "") => recordDashboardCheck(context, {
        eventId: checkId, timestamp: Date.now(), filePath: input.filePath,
        check: { concepts: question.conceptTags, question: question.question, answer, feedback, misconception,
          outcome, score, source: input.source ?? "walkthrough", mode: question.kind, filePath: null, retries: 0 },
      });
    const saveUnscored = async (outcome: "bypass" | "explained" | "ungraded", feedback = "") => {
      const record: AttemptRecord = {
        timestamp: Date.now(), language: input.language ?? "", charCount: input.snippet.length,
        mode: question.kind === "multiple-choice" ? "multiple-choice" : "free-text",
        conceptTags: question.conceptTags, passed: false, outcome, followups: 0,
        judgeConfigId: getJudgeConfigId(), source: input.source ?? "walkthrough", filePath: input.filePath,
      };
      await addAttempt(context, record);
      await logReview(context, {
        concepts: record.conceptTags, eventKind: outcome === "bypass" ? "bypass" : outcome === "explained" ? "explain" : "check",
        source: record.source, mode: record.mode, followups: 0, filePath: record.filePath,
        question: question.question, askedForExplanation: outcome === "explained", judgeConfigId: record.judgeConfigId,
      });
      // Unscored exits are history, not evidence for updating mastery/recall.
      await saveDashboard(outcome, null, "", feedback);
    };
    view.showQuestion(question);
    const action = await waitForQuizAction(view);
    if (action.type === "cancel") {
      await saveUnscored("ungraded", "Check closed before grading.");
      view.close();
      return false;
    }
    if (action.type === "bypass" || action.type === "explain") {
      await saveUnscored(action.type === "bypass" ? "bypass" : "explained");
      view.close();
      return true;
    }
    if (action.type !== "submit") {
      continue;
    }
    let passed = false;
    let ungraded = false;
    let score = 0;
    let misconception = "";
    if (question.kind === "multiple-choice") {
      passed = gradeMcq(question, action.selectedIndex ?? -1);
      score = passed ? 1 : 0;
    } else if (question.kind === "ordering") {
      score = gradeOrdering(question, action.order ?? []);
      passed = score >= 0.999;
    } else if (question.kind === "debug") {
      const plant = await beginDebug(input, input.snippet, question.buggyCode ?? "");
      if (!plant) {
        passed = false;
      } else {
        view.showFeedback({ message: "Edit the code in the editor, then submit again." });
        const retry = await waitForQuizAction(view);
        if (retry.type === "cancel" || retry.type === "bypass" || retry.type === "explain") {
          await saveUnscored(retry.type === "bypass" ? "bypass" : retry.type === "explain" ? "explained" : "ungraded");
          await restoreDebug(plant);
          view.close();
          return retry.type !== "cancel";
        }
        passed = sameCode(plant.editor.document.getText(plant.range), input.snippet);
        if (!passed) {
          await restoreDebug(plant);
        } else {
          plant.dispose();
        }
        score = passed ? 1 : 0;
      }
    } else {
      const res = await judge({
        context,
        snippet: input.snippet,
        language: input.language ?? "",
        question,
        studentAnswer: action.answer ?? "",
      });
      if (res.kind === "decided") {
        passed = aggregate(question.criteria, res.verdicts, getNonCriticalPassFraction()).outcome === "pass";
        misconception = res.misconception ?? "";
      } else {
        ungraded = true;
        passed = false;
      }
      score = passed ? 1 : 0;
    }
    const record: AttemptRecord = {
      timestamp: Date.now(),
      language: input.language ?? "",
      charCount: input.snippet.length,
      mode: question.kind === "multiple-choice" ? "multiple-choice" : "free-text",
      conceptTags: question.conceptTags,
      passed,
      outcome: ungraded ? "ungraded" : passed ? "pass" : "fail",
      followups: 0,
      judgeConfigId: getJudgeConfigId(),
      score: ungraded ? undefined : score,
      source: input.source ?? "walkthrough",
      filePath: input.filePath,
      misconceptions: misconception ? [misconception] : [],
    };
    await addAttempt(context, record);
    const masteryAfter = ungraded ? undefined : await rememberCheck(context, record);
    await logReview(context, {
      concepts: record.conceptTags,
      eventKind: "check",
      source: record.source,
      mode: record.mode,
      score: ungraded ? undefined : score,
      passed: ungraded ? undefined : passed,
      followups: 0,
      masteryAfter,
      filePath: record.filePath,
      question: question.question,
      studentAnswer: action.answer,
      misconception: passed || ungraded ? "" : misconception,
      askedForExplanation: false,
      explanation: "",
      judgeConfigId: record.judgeConfigId,
    });
    const answer = question.kind === "multiple-choice" ? question.options?.[action.selectedIndex ?? -1] ?? ""
      : question.kind === "ordering" ? (action.order ?? []).map(i => question.items?.[i] ?? String(i)).join(" → ")
      : action.answer ?? "";
    await saveDashboard(ungraded ? "ungraded" : passed ? "pass" : "fail", ungraded ? null : score,
      answer, ungraded ? "Grader could not decide." : passed ? "Correct." : "Not quite.", misconception);
    if (!passed) {
      failed = true;
      view.showFeedback({
        message: ungraded
          ? "Grading failed, so this answer was not scored."
          : "Not quite. The next question is coming, or try to remember this one.",
        passed: false,
      });
    }
  }
  view.close();
  return !failed;
}

async function beginDebug(
  meta: GateMeta | undefined,
  original: string,
  buggy: string,
): Promise<DebugPlant | undefined> {
  if (!buggy.trim()) {
    return undefined;
  }
  const editor = meta?.editor ?? vscode.window.visibleTextEditors.find((item) => {
    return meta?.filePath !== undefined && item.document.uri.fsPath === meta.filePath;
  });
  if (!editor) {
    return undefined;
  }
  meta?.lock?.pause();
  const startRange = meta?.range ?? findSnippetRange(editor.document, original);
  if (!startRange) {
    meta?.lock?.resume();
    return undefined;
  }
  state.suppressEditGuard = true;
  let applied = false;
  try {
    applied = await editor.edit((builder) => {
      builder.replace(startRange, buggy);
    });
  } finally {
    state.suppressEditGuard = false;
  }
  if (!applied) {
    meta?.lock?.resume();
    return undefined;
  }
  let live = insertedRange(startRange.start, buggy);
  const subscription = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document !== editor.document) {
      return;
    }
    for (const change of event.contentChanges) {
      live = shiftRange(live, change);
    }
  });
  return {
    editor,
    get range() {
      return live;
    },
    original,
    dispose() {
      subscription.dispose();
    },
  };
}

async function restoreDebug(plant: DebugPlant | undefined): Promise<void> {
  if (!plant) {
    return;
  }
  state.suppressEditGuard = true;
  try {
    await plant.editor.edit((builder) => {
      builder.replace(plant.range, plant.original);
    });
  } finally {
    state.suppressEditGuard = false;
    plant.dispose();
  }
}

function findSnippetRange(document: vscode.TextDocument, snippet: string): vscode.Range | undefined {
  const text = document.getText();
  const index = text.indexOf(snippet);
  if (index < 0) {
    return undefined;
  }
  return new vscode.Range(document.positionAt(index), document.positionAt(index + snippet.length));
}

function shiftRange(range: vscode.Range, change: vscode.TextDocumentContentChangeEvent): vscode.Range {
  return new vscode.Range(shiftPosition(range.start, change), shiftPosition(range.end, change));
}

function shiftPosition(pos: vscode.Position, change: vscode.TextDocumentContentChangeEvent): vscode.Position {
  const start = change.range.start;
  const end = change.range.end;
  if (pos.isBefore(start)) {
    return pos;
  }
  const inserted = insertedRange(start, change.text).end;
  if (pos.isAfterOrEqual(end)) {
    if (pos.line > end.line) {
      return pos.translate(inserted.line - end.line, 0);
    }
    return new vscode.Position(inserted.line, inserted.character + (pos.character - end.character));
  }
  return start;
}

function mapCriterionResults(
  verdicts: CriterionVerdict[],
): AttemptRecord["criterionResults"] {
  return verdicts.map((v) => ({ id: v.id, verdict: v.verdict }));
}

/**
 * Deterministic min-length gate, shown in the same webview as the LLM quiz.
 * Used when there is no API key or question generation fails.
 */
async function fallbackGate(snippet: string, language?: string, extensionUri?: vscode.Uri): Promise<boolean> {
  const minAnswerLength = getMinAnswerLength();
  const view = createQuizPanel(snippet, language ?? "", extensionUri);
  view.showQuestion({
    kind: "free-text",
    question: "What does this code do? Explain it in your own words to insert it.",
    referenceAnswer: "",
    criteria: [],
    conceptTags: [],
  });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const payload = await waitForQuizAction(view);

    if (payload.type === "explain") {
      view.showFeedback({
        message: "No model explanation is available for this check. The code stays.",
        explained: true,
      });
      vscode.window.setStatusBarMessage(
        "Comprehension Guard: explanation requested. The code stays and is not counted as correct.",
        5000,
      );
      return true;
    }

    if (payload.type === "bypass") {
      view.close();
      vscode.window.setStatusBarMessage(
        "Comprehension Guard: bypassed. The code stays and is not counted as correct.",
        4000,
      );
      return true;
    }

    if (payload.type === "dispute") {
      view.showFeedback({
        message: "This check is not graded by a model, so there is no misgrade to report. Use Bypass to keep the code.",
      });
      continue;
    }

    if (payload.type === "cancel") {
      view.close();
      vscode.window.setStatusBarMessage(
        "Comprehension Guard: quiz closed. The code was removed.",
        4000,
      );
      return false;
    }

    /* Fallback gate never shows the Next Question button, so this is a no-op. */
    if (payload.type === "next_question") { continue; }

    const answer = (payload.answer ?? "").trim();
    if (answer.length < minAnswerLength) {
      view.showFeedback({
        message: `Please explain a bit more (at least ${minAnswerLength} characters) to show you understand this code.`,
      });
      continue;
    }

    view.close();
    return true;
  }
}
