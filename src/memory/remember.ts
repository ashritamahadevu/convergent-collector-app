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
import { queueCard, queueFileKnowledge, queueMastery, queueProfile } from "./sync";

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
    .filter((card) => card.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt);
}

export function getFileKnowledge(context: vscode.ExtensionContext): FileKnowledge[] {
  const raw = context.globalState.get<FileKnowledge[]>(FILE_KEY, []);
  return Array.isArray(raw) ? raw : [];
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
): Promise<void> {
  await context.globalState.update(PROFILE_KEY, profile);
  queueProfile(context, profile);
}

/**
 * Updates mastery and the recall card after a graded check.
 * Bypass and explanation outcomes are not graded and must not call this.
 */
export async function rememberCheck(
  context: vscode.ExtensionContext,
  record: AttemptRecord,
): Promise<void> {
  const tags = record.conceptTags.length > 0 ? record.conceptTags : ["unspecified"];
  const score = record.score ?? (record.passed ? 1 : 0);
  const now = record.timestamp;
  const mastery = getMastery(context);
  const cards = getCards(context);

  for (const concept of tags) {
    const prior = mastery.find((row) => row.concept === concept);
    const guess = record.mode === "multiple-choice" ? MCQ_GUESS : DEFAULT_BKT.guess;
    const next = nextMastery(prior?.mastery ?? DEFAULT_BKT.prior, score, { ...DEFAULT_BKT, guess });
    const elo = nextElo(prior?.elo ?? 1000, score);
    const row: ConceptMastery = {
      concept,
      mastery: Math.round(next * 1000) / 1000,
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

    const card = reviewCard(cards.find((item) => item.concept === concept) ?? newCard(concept, now), score, now);
    const cardIndex = cards.findIndex((item) => item.concept === concept);
    if (cardIndex >= 0) {
      cards[cardIndex] = card;
    } else {
      cards.push(card);
    }
    queueCard(context, card);
  }

  await context.globalState.update(MASTERY_KEY, mastery);
  await context.globalState.update(CARD_KEY, cards);

  if (record.passed && record.filePath) {
    await markFile(context, {
      path: record.filePath.replace(/\\/g, "/"),
      concepts: tags,
      passed: true,
      aiWritten: record.source === "agent",
      updatedAt: now,
    });
  }
}

async function markFile(context: vscode.ExtensionContext, next: FileKnowledge): Promise<void> {
  const rows = getFileKnowledge(context);
  const index = rows.findIndex((row) => row.path === next.path);
  if (index >= 0) {
    const prev = rows[index];
    rows[index] = {
      ...next,
      concepts: Array.from(new Set([...prev.concepts, ...next.concepts])),
      aiWritten: prev.aiWritten || next.aiWritten,
    };
    queueFileKnowledge(context, rows[index]);
  } else {
    rows.push(next);
    queueFileKnowledge(context, next);
  }
  await context.globalState.update(FILE_KEY, rows);
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
