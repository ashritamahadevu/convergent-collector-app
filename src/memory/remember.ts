import * as vscode from "vscode";
import type { AttemptRecord, ConceptMastery, FileKnowledge, RecallCard } from "../types";
import {
  DEFAULT_BKT,
  MCQ_GUESS,
  discountJudgeScore,
  nextElo,
  nextMastery,
} from "./bkt";
import { newCard, reviewCard } from "./scheduler";
import { recordFile, recordMastery, recordProfile, recordRecallCard, recordReview, recordSettings } from "../dashboard/service";
import { queueCard, queueFileKnowledge, queueMastery, queueProfile, queueReview } from "./sync";

const MASTERY_KEY = "comprehensionGuard.conceptMastery";
const CARD_KEY = "comprehensionGuard.recallCards";
const PROFILE_KEY = "comprehensionGuard.profile";
const FILE_KEY = "comprehensionGuard.fileKnowledge";

export function getMastery(context: vscode.ExtensionContext): ConceptMastery[] {
  const raw = context.globalState.get<ConceptMastery[]>(MASTERY_KEY, []);
  return Array.isArray(raw) ? raw : [];
}

export function getCards(context: vscode.ExtensionContext): RecallCard[] {
  const raw = context.globalState.get<RecallCard[]>(CARD_KEY, []);
  return Array.isArray(raw) ? raw : [];
}

export function dueConcepts(context: vscode.ExtensionContext, now = Date.now()): RecallCard[] {
  return getCards(context)
    .filter((card) => card.topic && card.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt);
}

export function getFileKnowledge(context: vscode.ExtensionContext): FileKnowledge[] {
  const raw = context.globalState.get<FileKnowledge[]>(FILE_KEY, []);
  return Array.isArray(raw) ? raw : [];
}

export async function annotateFile(
  context: vscode.ExtensionContext,
  file: { path: string; concepts: string[]; topic?: string; core?: boolean; complexity?: number; centrality?: number },
): Promise<void> {
  await markFile(context, {
    path: file.path,
    concepts: file.concepts,
    passed: true,
    aiWritten: true,
    topic: file.topic,
    core: file.core,
    complexity: file.complexity,
    centrality: file.centrality,
    updatedAt: Date.now(),
  });
}

export function getProfile(context: vscode.ExtensionContext) {
  return context.globalState.get(PROFILE_KEY, {}) as {
    examDate?: string;
    interviewDate?: string;
    preferredLanguage?: string;
    strictness?: string;
  };
}

export async function saveProfile(
  context: vscode.ExtensionContext,
  profile: { examDate?: string; interviewDate?: string; preferredLanguage?: string; strictness?: string },
  syncDesktop = true,
): Promise<void> {
  await context.globalState.update(PROFILE_KEY, profile);
  queueProfile(context, profile);
  if (!syncDesktop) return;
  await recordProfile(context, profile);
  await recordSettings(context);
}

/**
 * Updates mastery and the recall card after a graded check.
 * Bypass and explanation outcomes are not graded and must not call this.
 */
export async function rememberCheck(
  context: vscode.ExtensionContext,
  record: AttemptRecord,
): Promise<number | undefined> {
  const tags = record.conceptTags.length > 0 ? record.conceptTags : ["unspecified"];
  let firstMastery: number | undefined;
  const score = record.score ?? (record.passed ? 1 : 0);
  const now = record.timestamp;
  const mastery = getMastery(context);
  const cards = getCards(context);

  for (const concept of tags) {
    const prior = mastery.find((row) => row.concept === concept);
    const guess = record.mode === "multiple-choice" ? MCQ_GUESS : DEFAULT_BKT.guess;
    const next = nextMastery(prior?.mastery ?? DEFAULT_BKT.prior, score, { ...DEFAULT_BKT, guess });
    const elo = nextElo(prior?.elo ?? 1000, score);
    const rounded = Math.round(next * 1000) / 1000;
    if (firstMastery === undefined) {
      firstMastery = rounded;
    }
    const row: ConceptMastery = {
      concept,
      mastery: rounded,
      elo,
      attempts: (prior?.attempts ?? 0) + 1,
      lastSeen: now,
    };
    const index = mastery.findIndex((item) => item.concept === concept);
    if (index >= 0) {
      mastery[index] = row;
    } else {
      mastery.push(row);
    }
    queueMastery(context, row);
    await recordMastery(context, row);
  }

  const topic = record.topic?.trim();
  if (topic) {
    const parent = tags[0] ?? "unspecified";
    const existing = cards.find((item) => item.topic === topic);
    const card = reviewCard(existing ?? newCard(parent, now, topic), score, now);
    const cardIndex = cards.findIndex((item) => item.topic === topic);
    if (cardIndex >= 0) {
      cards[cardIndex] = card;
    } else {
      cards.push(card);
    }
    queueCard(context, card);
    await recordRecallCard(context, card);
  }

  await context.globalState.update(MASTERY_KEY, mastery);
  await context.globalState.update(CARD_KEY, cards);

  if (record.passed && record.filePath) {
    await markFile(context, {
      path: record.filePath.replace(/\\/g, "/"),
      concepts: tags,
      topic: record.topic,
      passed: true,
      aiWritten: record.source === "agent",
      updatedAt: now,
    });
  }
  return firstMastery;
}

async function markFile(context: vscode.ExtensionContext, next: FileKnowledge): Promise<void> {
  const rows = getFileKnowledge(context);
  const index = rows.findIndex((row) => row.path === next.path);
  if (index >= 0) {
    const prev = rows[index];
    rows[index] = {
      ...prev,
      ...next,
      concepts: Array.from(new Set([...prev.concepts, ...next.concepts])),
      aiWritten: prev.aiWritten || next.aiWritten,
      topic: next.topic ?? prev.topic,
      core: next.core ?? prev.core,
      complexity: next.complexity ?? prev.complexity,
      centrality: next.centrality ?? prev.centrality,
    };
    queueFileKnowledge(context, rows[index]);
    await recordFile(context, rows[index]);
  } else {
    rows.push(next);
    queueFileKnowledge(context, next);
    await recordFile(context, next);
  }
  await context.globalState.update(FILE_KEY, rows);
}

export type ReviewEvent = {
  eventId?: string;
  concepts: string[];
  topic?: string;
  eventKind: "check" | "recall" | "bypass" | "explain";
  source?: string;
  mode?: string;
  shape?: "general" | "chunk";
  groupId?: string;
  score?: number;
  passed?: boolean;
  followups: number;
  masteryAfter?: number;
  filePath?: string;
  question?: string;
  studentAnswer?: string;
  misconception?: string;
  feedback?: string;
  outcome?: "pass" | "fail" | "bypass" | "explained" | "disputed" | "ungraded";
  askedForExplanation: boolean;
  explanation?: string;
  judgeConfigId?: string;
};

const REVIEW_KEY = "comprehensionGuard.reviewEvents";

export async function logReview(context: vscode.ExtensionContext, event: ReviewEvent): Promise<void> {
  const prev = context.globalState.get<ReviewEvent[]>(REVIEW_KEY, []);
  const next = [...(Array.isArray(prev) ? prev : []), event].slice(-1000);
  await context.globalState.update(REVIEW_KEY, next);
  queueReview(context, event);
  const outcome = event.outcome ?? (event.eventKind === "bypass"
    ? "bypass"
    : event.eventKind === "explain"
      ? "explained"
      : event.score === undefined && event.passed === undefined
        ? "ungraded"
        : event.passed
          ? "pass"
          : "fail");
  const eventId = event.eventId ?? randomId();
  await recordReview(context, {
    eventId,
    timestamp: Date.now(),
    concepts: event.concepts,
    topic: event.topic,
    question: event.question ?? "",
    answer: event.studentAnswer ?? "",
    feedback: event.feedback ?? (event.askedForExplanation ? "Explanation requested." : outcome === "pass" || outcome === "disputed" ? "Correct." : outcome === "ungraded" ? "Grader could not decide." : outcome === "fail" ? "Not quite." : ""),
    misconception: event.misconception ?? "",
    outcome,
    score: outcome === "bypass" || outcome === "explained" || outcome === "ungraded" ? null : event.score ?? null,
    source: event.source ?? "unknown",
    mode: event.mode ?? "free-text",
    shape: event.shape,
    groupId: event.groupId,
    filePath: event.filePath,
    retries: event.followups,
    masteryAfter: event.masteryAfter,
  });
}

function randomId(): string {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export function gradedScore(record: Pick<AttemptRecord, "mode" | "passed" | "criterionResults">): number {
  if (record.mode === "multiple-choice") {
    return record.passed ? 1 : 0;
  }
  const results = record.criterionResults ?? [];
  const applicable = results.filter((item) => item.verdict !== "n/a");
  const raw = applicable.length === 0
    ? (record.passed ? 1 : 0)
    : applicable.filter((item) => item.verdict === "pass").length / applicable.length;
  const passed = raw >= 0.5;
  const discounted = discountJudgeScore(passed);
  return raw === 0 || raw === 1 ? discounted : raw * discounted + (1 - raw) * (1 - discounted);
}

export function misconceptionsFor(record: Pick<AttemptRecord, "mode" | "passed" | "criterionResults">): string[] {
  if (record.passed) {
    return [];
  }
  if (record.mode === "multiple-choice") {
    return ["wrong-option"];
  }
  const missed = (record.criterionResults ?? [])
    .filter((item) => item.verdict === "fail")
    .map((item) => "criterion:" + item.id);
  return missed.length > 0 ? missed : ["incomplete-explanation"];
}
