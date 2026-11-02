import * as vscode from "vscode";
import { aggregate, gradeMcq, runPreChecks } from "./decision";
import { generateQuestion, getJudgeConfigId, judge } from "./llm";
import { getApiKey } from "./secrets";
import {
  getGradingMode,
  getMaxFollowups,
  getMinAnswerLength,
  getNonCriticalPassFraction,
  getProvider,
} from "./state";
import { addAttempt } from "./store";
import type { AttemptRecord, CriterionVerdict, GeneratedQuestion } from "./types";
import { createQuizPanel } from "./quizPanel";

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
): Promise<boolean> {
  if (!context) {
    return fallbackGate(snippet, language);
  }

  const provider = getProvider();
  const key = provider === "ollama" ? "local" : await getApiKey(context, provider);
  if (!key?.trim()) {
    if (!missingApiKeyHintShown) {
      missingApiKeyHintShown = true;
      void vscode.window.showInformationMessage(
        "Comprehension Guard: set an API key to enable LLM grading (command: Comprehension Guard: Set API Key).",
      );
    }
    return fallbackGate(snippet, language);
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
    return fallbackGate(snippet, language);
  }

  const view = createQuizPanel(snippet, lang);
  view.showQuestion(question);

  let followups = 0;
  const maxFollowups = getMaxFollowups();
  const judgeConfigId = getJudgeConfigId();

  const recordAttempt = async (
    passed: boolean,
    criterionResults?: AttemptRecord["criterionResults"],
  ): Promise<void> => {
    await addAttempt(context, {
      timestamp: Date.now(),
      language: lang,
      charCount: snippet.length,
      mode,
      conceptTags: question.conceptTags,
      criterionResults,
      passed,
      followups,
      judgeConfigId,
    });
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const payload = await view.waitForSubmit();

    if (payload === "cancel") {
      await recordAttempt(false);
      view.close();
      vscode.window.setStatusBarMessage(
        "Comprehension Guard: insertion blocked (no explanation given).",
        4000,
      );
      return false;
    }

    if (question.kind === "multiple-choice") {
      const selectedIndex = payload.selectedIndex;
      if (selectedIndex === undefined) {
        view.showFeedback({ message: "Please select an option before submitting." });
        continue;
      }

      const ok = gradeMcq(question, selectedIndex);
      if (ok) {
        await recordAttempt(true);
        view.close();
        return true;
      }

      followups += 1;

      if (followups < maxFollowups) {
        view.showFeedback({
          message: "That option is not correct. Look at the code again and try another.",
        });
        continue;
      }

      await recordAttempt(false);
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

    if (res.kind === "no_decision") {
      await recordAttempt(true);
      view.close();
      return true;
    }

    const agg = aggregate(
      question.criteria,
      res.verdicts,
      getNonCriticalPassFraction(),
    );

    const criterionResults = mapCriterionResults(res.verdicts);

    if (agg.outcome === "pass") {
      await recordAttempt(true, criterionResults);
      view.close();
      return true;
    }

    followups += 1;

    if (followups < maxFollowups) {
      view.showFeedback({
        message:
          "Not quite. Look at the part of the code the question asks about and describe what it does. The answer is not shown.",
      });
      continue;
    }

    await recordAttempt(false, criterionResults);
    view.close();
    return false;
  }
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
async function fallbackGate(snippet: string, language?: string): Promise<boolean> {
  const minAnswerLength = getMinAnswerLength();
  const view = createQuizPanel(snippet, language ?? "");
  view.showQuestion({
    kind: "free-text",
    question: "What does this code do? Explain it in your own words to insert it.",
    referenceAnswer: "",
    criteria: [],
    conceptTags: [],
  });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const payload = await view.waitForSubmit();

    if (payload === "cancel") {
      view.close();
      vscode.window.setStatusBarMessage(
        "Comprehension Guard: insertion blocked (no explanation given).",
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
