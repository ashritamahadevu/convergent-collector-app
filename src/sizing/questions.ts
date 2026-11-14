import type { GeneratedQuestion } from "../types";
import { analyzeFile } from "./analyze";
import { chooseChunk, type ChunkChoice, type LearnerPreferences } from "./chunkPolicy";
import type { DraftPlan, LocalQuestion, PlanSlot, QuestionType, UnitFact } from "./types";

/**
 * Offline questions for a pause. Multiple choice and ordering only,
 * graded locally so a check does not need a network call.
 */

const MARKUP_OPTION = "It is markup or config with no logic.";

const STEP_OPTIONS = ["read the inputs", "take the branch", "return a result"];

function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates. `answer[sourceIndex]` is where that item landed. */
function shuffleStable<T>(items: readonly T[], seed: string): { items: T[]; answer: number[] } {
  const rng = mulberry32(fnv1a32(seed));
  const tagged = items.map((item, index) => ({ item, index }));
  for (let i = tagged.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const swap = tagged[i];
    tagged[i] = tagged[j];
    tagged[j] = swap;
  }
  const answer = items.map((_, sourceIndex) => tagged.findIndex((entry) => entry.index === sourceIndex));
  return {
    items: tagged.map((entry) => entry.item),
    answer,
  };
}

function countPhrase(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function recursionWord(recursive: boolean): string {
  return recursive ? "recursive" : "not recursive";
}

function shapePhrase(unit: UnitFact): string {
  return `${countPhrase(unit.branches, "branch", "branches")}, ${countPhrase(unit.loops, "loop", "loops")}, ${recursionWord(unit.recursive)}`;
}

function wrongBranchPhrase(unit: UnitFact): string {
  const branches = unit.branches > 0 ? "no branches" : "several branches";
  return `${branches}, ${countPhrase(unit.loops, "loop", "loops")}, ${recursionWord(unit.recursive)}`;
}

function wrongRecursionPhrase(unit: UnitFact): string {
  return `${countPhrase(unit.branches, "branch", "branches")}, ${countPhrase(unit.loops, "loop", "loops")}, ${recursionWord(!unit.recursive)}`;
}

function findUnit(units: UnitFact[], slot: PlanSlot): UnitFact | undefined {
  return units.find((unit) => unit.file === slot.file && unit.unit === slot.unit);
}

function choiceQuestion(slot: PlanSlot, unit: UnitFact, prompt?: string): LocalQuestion {
  const truth = shapePhrase(unit);
  const shuffled = shuffleStable(
    [truth, wrongBranchPhrase(unit), wrongRecursionPhrase(unit), MARKUP_OPTION],
    `${unit.file}:${unit.unit}`,
  );
  return {
    type: "multiple_choice",
    prompt: prompt ?? `What is the control-flow shape of ${unit.unit} in ${unit.file}?`,
    unit: unit.unit,
    file: unit.file,
    concept: slot.concept,
    options: shuffled.items,
    answer: shuffled.answer[0] ?? 0,
    hint: "Count the ifs and loops in " + unit.unit,
    explanation: truth,
  };
}

function orderingQuestion(slot: PlanSlot, unit: UnitFact): LocalQuestion {
  const fromCalls = unit.calls.length >= 2;
  const source = fromCalls ? unit.calls.slice(0, 3) : STEP_OPTIONS;
  const shuffled = shuffleStable(source, `${unit.file}:${unit.unit}`);
  return {
    type: "ordering",
    prompt: fromCalls
      ? `In ${unit.unit}, put these calls in the order they appear.`
      : `In ${unit.unit}, put these steps in the order they happen.`,
    unit: unit.unit,
    file: unit.file,
    concept: slot.concept,
    options: shuffled.items,
    answer: shuffled.answer,
    hint: "Read the function from top to bottom.",
    explanation: source.join(" then "),
  };
}

const INSTANT_PREFS: LearnerPreferences = { preset: "standard", strictness: "standard" };
const ORDER_PREFS: LearnerPreferences = { preset: "quick", strictness: "standard" };

/**
 * A question graded on this machine. Parsing the snippet is the whole wait;
 * nothing is sent to a model.
 */
export async function localGeneratedQuestion(
  snippet: string,
  filePath: string,
  style: "auto" | "ordering" = "auto",
): Promise<GeneratedQuestion | null> {
  const analysis = await analyzeFile(filePath, snippet);
  const prefs = style === "ordering" ? ORDER_PREFS : INSTANT_PREFS;
  const choice = chooseChunk(analysis.units, prefs);
  if (!choice) {
    return null;
  }
  return generatedFromLocal(questionForChunk(choice, prefs));
}

/** The quiz panel's question shape for a question that is already graded locally. */
export function generatedFromLocal(local: LocalQuestion): GeneratedQuestion {
  if (local.type === "ordering" && Array.isArray(local.answer)) {
    return {
      kind: "ordering",
      question: local.prompt,
      referenceAnswer: local.explanation,
      criteria: [],
      items: local.options,
      correctOrder: local.answer,
      conceptTags: local.concept ? [local.concept] : [],
    };
  }
  return {
    kind: "multiple-choice",
    question: local.prompt,
    referenceAnswer: local.explanation,
    criteria: [],
    options: local.options,
    correctIndex: typeof local.answer === "number" ? local.answer : 0,
    conceptTags: local.concept ? [local.concept] : [],
  };
}

/** One question for the chunk the preference policy selected. */
export function questionForChunk(choice: ChunkChoice, prefs: LearnerPreferences): LocalQuestion {
  const slot: PlanSlot = {
    type: choice.questionType,
    unit: choice.unit.unit,
    file: choice.unit.file,
    concept: choice.concept,
    keyIdea: choice.unit.signature,
    points: 3,
    estimatedSeconds: 20,
  };
  const language = prefs.preferredLanguage?.trim();
  const suffix = language ? ` Answer in ${language}.` : "";
  if (choice.questionType === "ordering") {
    const question = orderingQuestion(slot, choice.unit);
    return {
      ...question,
      prompt: question.prompt + suffix,
      code: choice.unit.code,
      requestedKind: choice.questionType,
    };
  }
  return {
    ...choiceQuestion(slot, choice.unit, promptForKind(choice.questionType, choice.unit) + suffix),
    code: choice.unit.code,
    requestedKind: choice.questionType,
  };
}

function promptForKind(type: QuestionType, unit: UnitFact): string {
  if (type === "predict") {
    return `Predict the control flow of ${unit.unit} in ${unit.file}. Which shape runs?`;
  }
  if (type === "explain") {
    return `Explain ${unit.unit} in ${unit.file}. Which description is true?`;
  }
  if (type === "change") {
    return `What describes ${unit.unit} in ${unit.file} before any change?`;
  }
  return `What is the control-flow shape of ${unit.unit} in ${unit.file}?`;
}

export function questionsFor(plan: DraftPlan, units: UnitFact[]): LocalQuestion[] {
  const questions: LocalQuestion[] = [];
  for (const slot of plan.slots) {
    const unit = findUnit(units, slot);
    if (!unit) continue;
    questions.push(slot.type === "ordering" ? orderingQuestion(slot, unit) : choiceQuestion(slot, unit));
  }
  return questions;
}

function sameNumbers(answer: number[], order: number[]): boolean {
  if (answer.length !== order.length) return false;
  for (let i = 0; i < answer.length; i += 1) {
    if (answer[i] !== order[i]) return false;
  }
  return true;
}

export function gradeLocal(
  question: LocalQuestion,
  response: { selectedIndex?: number; order?: number[] },
): boolean {
  if (question.type === "multiple_choice") {
    return response.selectedIndex === question.answer;
  }
  return Array.isArray(response.order) && Array.isArray(question.answer) && sameNumbers(question.answer, response.order);
}
