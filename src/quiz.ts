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
  subscribeQuizBypass,
  takeQuizBypass,
} from "./state";
import { gradedScore, logReview, misconceptionsFor, rememberCheck } from "./memory/remember";
import { addAttempt, saveMisgradeReport } from "./store";
import type { AttemptOutcome, AttemptRecord, AttemptSource, CriterionVerdict, GeneratedQuestion } from "./types";
import { createQuizPanel, type QuizAction } from "./quizPanel";

let missingApiKeyHintShown = false;

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
  meta?: {
    source?: AttemptSource;
    filePath?: string;
    recall?: boolean;
    editor?: vscode.TextEditor;
    range?: vscode.Range;
  },
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

  let question: GeneratedQuestion;
  try {
    question = await generateQuestion({
      context,
      snippet,
      language: lang,
      mode,
    });
  } catch {
    return fallbackGate(snippet, language, context.extensionUri);
  }

  const view = createQuizPanel(snippet, lang, context.extensionUri);
  view.showQuestion(question);

  /* Highlight the pasted lines in the active editor for the duration of the quiz */
  let pasteDecoration: vscode.TextEditorDecorationType | undefined;
  if (meta?.editor && meta?.range) {
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
    draft.score = scoreOverride ?? gradedScore(draft);
    await addAttempt(context, draft);
    let masteryAfter: number | undefined;
    if (outcome === "pass" || outcome === "fail" || outcome === "disputed") {
      masteryAfter = await rememberCheck(context, draft);
    }
    await logReview(context, {
      concepts: draft.conceptTags,
      eventKind: outcome === "bypass" ? "bypass" : outcome === "explained" ? "explain" : meta?.recall ? "recall" : "check",
      source: draft.source,
      mode: draft.mode,
      score: outcome === "bypass" ? undefined : draft.score,
      passed: outcome === "bypass" || outcome === "explained" ? undefined : draft.passed,
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
  };

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const payload = await waitForQuizAction(view);

      if (payload.type === "explain") {
        const explanation = question.referenceAnswer.trim();
        view.showFeedback({
          message: explanation
            ? "Explanation: " + explanation
            : "No explanation was generated for this check. The code stays.",
          explained: true,
        });
        await recordAttempt(false, "explained");
        vscode.window.setStatusBarMessage(
          "Comprehension Guard: explanation shown. The code stays and is not counted as correct.",
          5000,
        );
        // Wait for the user to dismiss the explanation card (expNextBtn posts cancel,
        // or the user closes the panel). Without this, the panel stays open with no
        // extension listening, causing any subsequent submit to hang forever.
        await view.waitForSubmit();
        view.close();
        return true;
      }

      if (payload.type === "bypass") {
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
        await recordAttempt(false, "fail");
        view.close();
        vscode.window.setStatusBarMessage(
          "Comprehension Guard: quiz closed. The code was removed.",
          4000,
        );
        return false;
      }

      lastStudentAnswer = (payload.answer ?? "").trim();

      if (question.kind === "multiple-choice") {
        const selectedIndex = payload.selectedIndex;
        if (selectedIndex === undefined) {
          view.showFeedback({ message: "Please select an option before submitting." });
          continue;
        }

        const ok = gradeMcq(question, selectedIndex);
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
          view.showFeedback({ message: lastFeedback, allowDispute: true, passed: false });
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

      const res = await judge({
        context,
        snippet,
        language: lang,
        question,
        studentAnswer: payload.answer ?? "",
      });

      if (takeQuizBypass()) {
        await recordAttempt(false, "bypass");
        view.close();
        vscode.window.setStatusBarMessage(
          "Comprehension Guard: bypassed. The code stays and is not counted as correct.",
          4000,
        );
        return true;
      }

      if (res.kind === "decided") {
        lastMisconception = res.misconception ?? "";
      }

      if (res.kind === "no_decision") {
        await recordAttempt(true, "pass");
        view.showFeedback({ message: "Correct! The code has been accepted.", passed: true });
        await new Promise<void>((resolve) => setTimeout(resolve, 1200));
        view.close();
        return true;
      }

      const agg = aggregate(
        question.criteria,
        res.verdicts,
        getNonCriticalPassFraction(),
      );

      const criterionResults = mapCriterionResults(res.verdicts);
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
    return true;
  }
  const view = createQuizPanel(input.snippet, input.language ?? "", context.extensionUri);
  for (const question of input.questions) {
    view.showQuestion(question);
    const action = await waitForQuizAction(view);
    if (action.type === "cancel") {
      view.close();
      return false;
    }
    if (action.type === "bypass" || action.type === "explain") {
      view.close();
      return true;
    }
    if (action.type !== "submit") {
      continue;
    }
    let passed = false;
    let score = 0;
    let misconception = "";
    if (question.kind === "multiple-choice") {
      passed = gradeMcq(question, action.selectedIndex ?? -1);
      score = passed ? 1 : 0;
    } else if (question.kind === "ordering") {
      score = gradeOrdering(question, action.order ?? []);
      passed = score >= 0.999;
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
        passed = true;
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
      outcome: passed ? "pass" : "fail",
      followups: 0,
      judgeConfigId: getJudgeConfigId(),
      score,
      source: input.source ?? "walkthrough",
      filePath: input.filePath,
      misconceptions: misconception ? [misconception] : [],
    };
    await addAttempt(context, record);
    const masteryAfter = await rememberCheck(context, record);
    await logReview(context, {
      concepts: record.conceptTags,
      eventKind: "check",
      source: record.source,
      mode: record.mode,
      score,
      passed,
      followups: 0,
      masteryAfter,
      filePath: record.filePath,
      question: question.question,
      studentAnswer: action.answer,
      misconception: passed ? "" : misconception,
      askedForExplanation: false,
      explanation: "",
      judgeConfigId: record.judgeConfigId,
    });
    if (!passed) {
      view.showFeedback({ message: "Not quite. The next question is coming, or try to remember this one.", passed: false });
    }
  }
  view.close();
  return true;
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
