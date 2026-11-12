import type { CheckPreset, QuestionType, UnitFact } from "./types";

/**
 * Chooses the one chunk to ask about, and the question type, from the
 * student's preferences. The coding agent is told to write that one chunk
 * next. A correct answer is what unlocks the following chunk.
 */

export type LearnerPreferences = {
  preset: CheckPreset;
  preferredLanguage?: string;
  /** lenient asks multiple choice. strict asks the deepest type the preset allows. */
  strictness?: string;
  examDate?: string;
  interviewDate?: string;
  /** Concept name to mastery, 0 to 1. Missing concepts stay unknown. */
  masteryByConcept?: Record<string, number>;
  /** Used for exam and interview proximity. Defaults to the current time. */
  now?: number;
};

export type ChunkChoice = {
  unit: UnitFact;
  questionType: QuestionType;
  concept: string;
  reason: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function chooseChunk(units: UnitFact[], prefs: LearnerPreferences): ChunkChoice | null {
  const ranked = units
    .filter((unit) => unit.logic > 0 && unit.formulaValue > 0)
    .slice()
    .sort(
      (a, b) =>
        b.formulaValue - a.formulaValue || a.file.localeCompare(b.file) || a.unit.localeCompare(b.unit),
    );
  for (const unit of ranked) {
    if (skipKnown(unit, prefs)) {
      continue;
    }
    const questionType = questionKind(unit, prefs);
    const concept = conceptOf(unit);
    return {
      unit,
      questionType,
      concept,
      reason: reasonFor(unit, prefs, questionType, concept),
    };
  }
  return null;
}

export function questionKind(unit: UnitFact, prefs: LearnerPreferences): QuestionType {
  const strictness = normalizeStrictness(prefs.strictness);
  const preset = effectivePreset(prefs);
  if (strictness === "lenient") {
    return "multiple_choice";
  }
  const mastery = masteryFor(unit, prefs);
  if (preset === "deep" || strictness === "strict") {
    if (preset === "deep" && unit.formulaValue >= 8) {
      return "change";
    }
    if (preset === "quick") {
      return hasSteps(unit) ? "ordering" : "multiple_choice";
    }
    if (strictness === "strict" || mastery < 0.45) {
      return "explain";
    }
    return unit.formulaValue >= 2 ? "predict" : "multiple_choice";
  }
  if (preset === "quick") {
    return hasSteps(unit) ? "ordering" : "multiple_choice";
  }
  if (mastery < 0.4) {
    return "explain";
  }
  if (unit.formulaValue >= 2) {
    return "predict";
  }
  return "multiple_choice";
}

export function oneChunkMessage(prefs: LearnerPreferences, chunkCount: number): string {
  return (
    "Write one chunk only, a single function or method, then stop. " +
    `This edit has ${chunkCount} chunks. ` +
    preferenceSummary(prefs) +
    " After that chunk lands, the student answers one question. Retry with the first chunk."
  );
}

export function nextChunkMessage(prefs: LearnerPreferences): string {
  return (
    "The check passed. Write the next chunk as one function or method, then stop. " +
    preferenceSummary(prefs)
  );
}

export function conceptOf(unit: UnitFact): string {
  return unit.riskTags[0] ?? "control flow";
}

function skipKnown(unit: UnitFact, prefs: LearnerPreferences): boolean {
  if (normalizeStrictness(prefs.strictness) === "strict") {
    return false;
  }
  if (effectivePreset(prefs) === "deep") {
    return false;
  }
  if (examSoon(prefs) || interviewSoon(prefs)) {
    return false;
  }
  return masteryFor(unit, prefs) >= 0.8;
}

function masteryFor(unit: UnitFact, prefs: LearnerPreferences): number {
  const concept = conceptOf(unit);
  const fromProfile = prefs.masteryByConcept?.[concept];
  if (typeof fromProfile === "number" && Number.isFinite(fromProfile)) {
    return clamp(fromProfile, 0, 1);
  }
  return clamp(unit.mastery, 0, 1);
}

function effectivePreset(prefs: LearnerPreferences): CheckPreset {
  if (examSoon(prefs) || interviewSoon(prefs)) {
    return prefs.preset === "quick" ? "standard" : "deep";
  }
  return prefs.preset;
}

function examSoon(prefs: LearnerPreferences): boolean {
  return withinDays(prefs.examDate, prefs.now ?? Date.now(), 14);
}

function interviewSoon(prefs: LearnerPreferences): boolean {
  return withinDays(prefs.interviewDate, prefs.now ?? Date.now(), 14);
}

function withinDays(value: string | undefined, now: number, days: number): boolean {
  if (!value?.trim()) {
    return false;
  }
  const parsed = Date.parse(value.trim());
  if (Number.isNaN(parsed)) {
    return false;
  }
  const delta = (parsed - now) / DAY_MS;
  return delta >= -1 && delta <= days;
}

function hasSteps(unit: UnitFact): boolean {
  return unit.branches + unit.loops >= 2 || unit.calls.length >= 2;
}

function normalizeStrictness(value: string | undefined): "lenient" | "standard" | "strict" {
  const text = value?.trim().toLowerCase();
  if (text === "lenient" || text === "strict") {
    return text;
  }
  return "standard";
}

function reasonFor(unit: UnitFact, prefs: LearnerPreferences, questionType: QuestionType, concept: string): string {
  const mastery = masteryFor(unit, prefs);
  return `${unit.unit} is the next chunk. Ask a ${questionType.replace("_", " ")} question on ${concept}. Mastery ${mastery.toFixed(2)}. ${preferenceSummary(prefs)}`;
}

function preferenceSummary(prefs: LearnerPreferences): string {
  const language = prefs.preferredLanguage?.trim();
  const parts = [
    `Preset ${effectivePreset(prefs)}`,
    `strictness ${normalizeStrictness(prefs.strictness)}`,
  ];
  if (language) {
    parts.push(`preferred language ${language}`);
  }
  if (examSoon(prefs)) {
    parts.push("exam within 14 days");
  }
  if (interviewSoon(prefs)) {
    parts.push("interview within 14 days");
  }
  return parts.join(", ") + ".";
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}
