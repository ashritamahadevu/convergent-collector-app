import type { AgentEdit } from "./agentProtocol";
import { normPath } from "./agentProtocol";
import { analyzeFile } from "./sizing/analyze";
import { chunkSizeFor, planPreset, type LearnerPreferences } from "./sizing/chunkPolicy";
import { draftPlan } from "./sizing/plan";
import { unitsTouchedByEdit } from "./sizing/touched";
import type { QuestionType, UnitFact } from "./sizing/types";
import type { QuestionKind } from "./types";

/**
 * How a finished agent change is checked.
 * A general check keeps the code out of the editor until the questions pass.
 * A chunk check highlights each planned unit in place.
 * In both cases the tree-sitter plan decides how many questions and which type.
 */
export type CheckShape = "general" | "chunks";

export type CodeChunk = {
  filePath: string;
  unit: string;
  code: string;
  startLine: number;
  endLine: number;
  fact: UnitFact;
  /** Question type chosen by the tree-sitter plan for this unit. */
  questionType: QuestionType;
};

export type PlannedCheck = {
  /** One entry per plan slot, in the plan's order. */
  chunks: CodeChunk[];
  /** True when tree-sitter found at least one unit, even if none earned a question. */
  sawUnits: boolean;
};

/** Quick and lenient checks cover the whole change. The others walk it chunk by chunk. */
export function checkShapeFor(prefs: LearnerPreferences): CheckShape {
  return chunkSizeFor(prefs) === "file" ? "general" : "chunks";
}

/** One held edit per file: the original text, and the file after the agent finished. */
export function collapseEdits(edits: readonly AgentEdit[]): AgentEdit[] {
  const byPath = new Map<string, AgentEdit>();
  for (const edit of edits) {
    const key = normPath(edit.filePath);
    const prior = byPath.get(key);
    if (!prior) {
      byPath.set(key, edit);
      continue;
    }
    const previous = prior.restore?.previous ?? edit.restore?.previous;
    const next = edit.restore?.next ?? edit.next ?? prior.restore?.next ?? prior.next;
    byPath.set(key, {
      ...edit,
      snippet: joinSnippet(prior.snippet, edit.snippet),
      hunks: [...prior.hunks, ...edit.hunks],
      created: prior.created || edit.created,
      next: edit.next ?? prior.next,
      restore: previous !== undefined && next !== undefined ? { previous, next } : edit.restore ?? prior.restore,
    });
  }
  return [...byPath.values()];
}

/**
 * Questions for a finished change.
 * Tree-sitter scores the generated units, and `draftPlan` picks how many fit
 * the preset and which type each one is. Units that score zero are left out.
 */
export async function planForEdits(
  edits: readonly AgentEdit[],
  prefs: LearnerPreferences,
): Promise<PlannedCheck> {
  const units: UnitFact[] = [];
  let sawUnits = false;
  for (const edit of collapseEdits(edits)) {
    const source = edit.next ?? edit.restore?.next ?? edit.snippet;
    if (!source.trim()) {
      continue;
    }
    const analysis = await analyzeFile(edit.filePath, source);
    if (analysis.units.length > 0) {
      sawUnits = true;
    }
    units.push(
      ...unitsTouchedByEdit(analysis.units, {
        snippet: edit.snippet,
        hunks: edit.hunks,
        created: edit.created,
      }),
    );
  }
  const plan = draftPlan(units, planPreset(prefs));
  const chunks: CodeChunk[] = [];
  for (const slot of plan.slots) {
    const fact = units.find((unit) => unit.file === slot.file && unit.unit === slot.unit);
    if (!fact) {
      continue;
    }
    chunks.push({
      filePath: fact.file,
      unit: fact.unit,
      code: fact.code,
      startLine: fact.startLine,
      endLine: fact.endLine,
      fact,
      questionType: slot.type,
    });
  }
  return { chunks, sawUnits };
}

/** The model kind that asks for the type the plan selected. */
export function modelKindFor(type: QuestionType): QuestionKind {
  if (type === "multiple_choice") {
    return "multiple-choice";
  }
  if (type === "ordering") {
    return "ordering";
  }
  if (type === "change") {
    return "debug";
  }
  return "free-text";
}

function joinSnippet(left: string, right: string): string {
  const merged = [left.trim(), right.trim()].filter((part) => part.length > 0).join("\n\n");
  return merged.slice(0, 8000);
}
