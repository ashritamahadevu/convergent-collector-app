import type { UnitFact } from "./types";

/** The part of an agent edit used to decide which units the student must know. */
export type TouchEdit = {
  snippet?: string;
  hunks?: { newText?: string }[];
  created?: boolean;
};

/**
 * Keep units the edit actually wrote.
 * A long insertion matches every unit that contains it.
 * A short insertion matches only the smallest unit that contains it,
 * so a one-line change does not quiz the rest of the file.
 */
export function unitsTouchedByEdit(units: UnitFact[], edit: TouchEdit): UnitFact[] {
  const live = units.filter((unit) => unit.logic > 0 && unit.formulaValue > 0);
  if (live.length === 0) {
    return [];
  }
  if (edit.created) {
    return live;
  }
  const needles = uniqueNeedles(edit);
  if (needles.length === 0) {
    return [];
  }
  const picked = new Map<string, UnitFact>();
  for (const needle of needles) {
    const hits = live.filter((unit) => unit.code.includes(needle));
    const chosen = needle.length >= 40 ? hits : tightest(hits);
    for (const unit of chosen) {
      picked.set(`${unit.file}:${unit.unit}:${unit.startLine}`, unit);
    }
  }
  if (picked.size > 0) {
    return [...picked.values()];
  }
  const snippet = (edit.snippet ?? "").trim();
  if (snippet.length >= 8) {
    return live.filter((unit) => {
      const code = unit.code.trim();
      return code.length >= 8 && snippet.includes(code);
    });
  }
  return [];
}

function uniqueNeedles(edit: TouchEdit): string[] {
  const found: string[] = [];
  const push = (text: string | undefined) => {
    const trimmed = text?.trim() ?? "";
    if (trimmed.length < 8 || found.includes(trimmed)) {
      return;
    }
    found.push(trimmed);
  };
  for (const hunk of edit.hunks ?? []) {
    push(hunk.newText);
  }
  push(edit.snippet);
  return found;
}

function tightest(hits: UnitFact[]): UnitFact[] {
  if (hits.length === 0) {
    return [];
  }
  const smallest = hits.reduce((best, unit) => (unit.code.length < best.code.length ? unit : best));
  return [smallest];
}
