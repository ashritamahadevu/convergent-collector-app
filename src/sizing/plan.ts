import { canonicalConcept } from "./concepts";
import type {
  CheckPreset,
  DraftPlan,
  PlanSlot,
  QuestionType,
  SkippedFile,
  SizingAdjustment,
  UnitFact,
} from "./types";

/**
 * Drafts a deterministic question plan from scored units.
 *
 * One slot is emitted per file+unit. Richer question types are tried first
 * and kept only when they fit the preset's remaining time budget. A model
 * may later multiply importance, merge units, or un-skip a file, but
 * `applyAdjustment` clamps that review so it cannot own the question count.
 */

const QUESTION: Record<QuestionType, { points: number; seconds: number }> = {
  multiple_choice: { points: 3, seconds: 20 },
  ordering: { points: 3, seconds: 30 },
  predict: { points: 5, seconds: 45 },
  explain: { points: 7, seconds: 90 },
  change: { points: 10, seconds: 180 },
};

const PRESET: Record<
  CheckPreset,
  { budget: number; target: number; ladder: readonly QuestionType[] }
> = {
  quick: {
    budget: 120,
    target: 0.4,
    ladder: ["ordering", "multiple_choice"],
  },
  standard: {
    budget: 300,
    target: 0.7,
    ladder: ["explain", "predict", "ordering", "multiple_choice"],
  },
  deep: {
    budget: 300,
    target: 0.95,
    ladder: ["change", "explain", "predict", "ordering", "multiple_choice"],
  },
};

/** One sitting is 300 seconds. Up to 360 still counts as a single session. */
const SITTING_SECONDS = 300;
const SINGLE_SITTING_MAX = 360;
const MAX_SESSIONS = 6;

export type ConceptOverride = {
  concept?: string;
  keyIdea?: string;
};

export type DraftPlanOptions = {
  skipped?: SkippedFile[];
  /** Unit-name overrides from a clamped adjustment. Not stored on UnitFact. */
  concepts?: ReadonlyMap<string, ConceptOverride>;
  /**
   * Groups of unit names that share a slot. Overlapping groups are united.
   * Only the highest-value eligible member is questioned.
   */
  merge?: string[][];
};

type MergeGroup = {
  members: UnitFact[];
  representative: UnitFact;
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function emptyPlan(preset: CheckPreset): DraftPlan {
  return {
    preset,
    slots: [],
    sessions: 1,
    estimatedSeconds: 0,
    coverage: 0,
    totalValue: 0,
  };
}

function slotKey(file: string, unit: string): string {
  return `${file}\0${unit}`;
}

function compareUnits(a: UnitFact, b: UnitFact): number {
  if (a.formulaValue !== b.formulaValue) return b.formulaValue - a.formulaValue;
  if (a.file < b.file) return -1;
  if (a.file > b.file) return 1;
  if (a.unit < b.unit) return -1;
  if (a.unit > b.unit) return 1;
  return 0;
}

function eligible(unit: UnitFact): boolean {
  return unit.logic > 0 && unit.formulaValue > 0;
}

function typeAllowed(type: QuestionType, unit: UnitFact, preset: CheckPreset): boolean {
  if (type === "ordering") {
    return unit.branches + unit.loops >= 2 || unit.calls.length >= 2;
  }
  if (type === "change") return preset === "deep" && unit.formulaValue >= 8;
  if (type === "explain") return unit.formulaValue >= 4;
  if (type === "predict") return unit.formulaValue >= 2;
  return true;
}

function pickType(unit: UnitFact, preset: CheckPreset, remaining: number): QuestionType | null {
  for (const type of PRESET[preset].ladder) {
    if (!typeAllowed(type, unit, preset)) continue;
    if (QUESTION[type].seconds <= remaining) return type;
  }
  return null;
}

function fileBasename(file: string): string {
  const normalized = file.replace(/\\/g, "/").replace(/\/+$/, "");
  const slash = normalized.lastIndexOf("/");
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return base || file;
}

/**
 * Merged units share one slot on the highest-value member that can be
 * questioned (logic > 0 and formulaValue > 0). Covered value for that slot
 * is min(sum of the group's formula values, slot points). Members that do
 * not count toward totalValue are left out of the sum so they cannot inflate
 * coverage. Ties use the same file, then unit-name, order as the walk.
 */
function coveredBySlot(unit: UnitFact, points: number, group: MergeGroup | undefined): number {
  if (!group) return Math.min(unit.formulaValue, points);
  let sum = 0;
  for (const member of group.members) {
    if (eligible(member)) sum += member.formulaValue;
  }
  return Math.min(sum, points);
}

function buildMergeGroups(units: UnitFact[], merge: string[][] | undefined): Map<UnitFact, MergeGroup> {
  const groups = new Map<UnitFact, MergeGroup>();
  if (!Array.isArray(merge)) return groups;

  const byName = new Map<string, UnitFact[]>();
  for (const unit of units) {
    const list = byName.get(unit.unit);
    if (list) list.push(unit);
    else byName.set(unit.unit, [unit]);
  }

  const parent = new Map<string, string>();
  const find = (name: string): string => {
    let root = name;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    let cursor = name;
    while (cursor !== root) {
      const next = parent.get(cursor) as string;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (left: string, right: string): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(leftRoot, rightRoot);
  };

  const known = new Set(byName.keys());
  for (const entry of merge) {
    if (!Array.isArray(entry)) continue;
    const names = entry.filter((name): name is string => typeof name === "string" && known.has(name));
    if (names.length < 2) continue;
    for (const name of names) {
      if (!parent.has(name)) parent.set(name, name);
    }
    for (let index = 1; index < names.length; index += 1) union(names[0], names[index]);
  }

  const buckets = new Map<string, UnitFact[]>();
  for (const [name, list] of byName) {
    if (!parent.has(name)) continue;
    const root = find(name);
    const bucket = buckets.get(root);
    if (bucket) bucket.push(...list);
    else buckets.set(root, [...list]);
  }

  for (const members of buckets.values()) {
    const eligibleMembers = members.filter(eligible);
    if (eligibleMembers.length < 2) continue;
    const representative = [...eligibleMembers].sort(compareUnits)[0];
    const group: MergeGroup = { members, representative };
    for (const member of members) groups.set(member, group);
  }
  return groups;
}

function conceptFor(unit: UnitFact, override: ConceptOverride | undefined): string {
  if (override?.concept && override.concept.length > 0) return override.concept;
  return canonicalConcept(unit);
}

function keyIdeaFor(unit: UnitFact, override: ConceptOverride | undefined): string {
  if (override?.keyIdea && override.keyIdea.length > 0) return override.keyIdea;
  const signature = unit.signature.trim();
  return signature.length > 0 ? signature.slice(0, 120) : unit.unit;
}

function makeSlot(unit: UnitFact, type: QuestionType, override: ConceptOverride | undefined): PlanSlot {
  const cost = QUESTION[type];
  return {
    type,
    unit: unit.unit,
    file: unit.file,
    concept: conceptFor(unit, override),
    keyIdea: keyIdeaFor(unit, override),
    points: cost.points,
    estimatedSeconds: cost.seconds,
  };
}

/**
 * Sessions stay at 1 when the plan is empty or fits in one sitting (360s).
 * A plan that runs past 300 seconds and still misses the coverage target is
 * split into sittings of 300 seconds, at least 2 and at most 6. Preset
 * budgets are 120 or 300, so a normal draft stays at one session. The split
 * is what a longer forced plan would report.
 */
function sessionCount(
  estimatedSeconds: number,
  covered: number,
  totalValue: number,
  target: number,
  slots: number,
): number {
  if (slots === 0) return 1;
  const short = covered + 1e-9 < target * totalValue;
  if (short && estimatedSeconds > SITTING_SECONDS) {
    return Math.min(MAX_SESSIONS, Math.max(2, Math.ceil(estimatedSeconds / SITTING_SECONDS)));
  }
  if (estimatedSeconds <= SINGLE_SITTING_MAX) return 1;
  return 1;
}

export function draftPlan(units: UnitFact[], preset: CheckPreset, opts?: DraftPlanOptions): DraftPlan {
  if (!Array.isArray(units)) return emptyPlan(preset);
  const rules = PRESET[preset];
  if (!rules) return emptyPlan(preset);

  const considered = units.filter(eligible).sort(compareUnits);
  const totalValue = round1(considered.reduce((sum, unit) => sum + unit.formulaValue, 0));
  if (!(totalValue > 0)) return emptyPlan(preset);

  const groups = buildMergeGroups(units, opts?.merge);
  const concepts = opts?.concepts;
  const seen = new Set<string>();
  const slots: PlanSlot[] = [];
  let covered = 0;
  let remaining = rules.budget;

  const emit = (unit: UnitFact, type: QuestionType): void => {
    const key = slotKey(unit.file, unit.unit);
    if (seen.has(key)) return;
    seen.add(key);
    const slot = makeSlot(unit, type, concepts?.get(unit.unit));
    slots.push(slot);
    covered += coveredBySlot(unit, slot.points, groups.get(unit));
    remaining -= slot.estimatedSeconds;
  };

  for (const unit of considered) {
    const key = slotKey(unit.file, unit.unit);
    if (seen.has(key)) continue;
    const group = groups.get(unit);
    if (group && group.representative !== unit) continue;
    const type = pickType(unit, preset, remaining);
    if (!type) break;
    emit(unit, type);
  }

  if (slots.length === 0 && units.some((unit) => unit.logic > 0)) {
    const fallback = considered[0];
    if (fallback) emit(fallback, "multiple_choice");
  }

  const estimatedSeconds = slots.reduce((sum, slot) => sum + slot.estimatedSeconds, 0);
  const coverage = clamp(round2(covered / totalValue), 0, 1);
  return {
    preset,
    slots,
    sessions: sessionCount(estimatedSeconds, covered, totalValue, rules.target, slots.length),
    estimatedSeconds,
    coverage,
    totalValue,
  };
}

function cloneUnit(unit: UnitFact): UnitFact {
  return {
    ...unit,
    calls: [...unit.calls],
    callers: [...unit.callers],
    riskTags: [...unit.riskTags],
  };
}

/**
 * Original 0 may grow to 1 (a single un-skip). Original 1 may be 1 or 2.
 * Larger plans must stay inside ±50% of the original slot count.
 */
function slotCountAllowed(originalCount: number, nextCount: number): boolean {
  if (originalCount <= 0) return nextCount <= 1;
  if (originalCount === 1) return nextCount === 1 || nextCount === 2;
  return nextCount >= originalCount * 0.5 && nextCount <= originalCount * 1.5;
}

function isForcedSingleChoice(plan: DraftPlan): boolean {
  return (
    plan.slots.length === 1 &&
    plan.slots[0]?.type === "multiple_choice" &&
    plan.estimatedSeconds === QUESTION.multiple_choice.seconds
  );
}

/**
 * Deep adjustments may not drop a logic unit that already has a slot.
 * Units the budget never reached were not dropped.
 */
function dropsSlottedLogic(units: UnitFact[], original: DraftPlan, candidate: DraftPlan): boolean {
  const logicByKey = new Map<string, number>();
  for (const unit of units) logicByKey.set(slotKey(unit.file, unit.unit), unit.logic);
  const kept = new Set(candidate.slots.map((slot) => slotKey(slot.file, slot.unit)));
  return original.slots.some((slot) => {
    const key = slotKey(slot.file, slot.unit);
    const logic = logicByKey.get(key);
    return logic !== undefined && logic > 0 && !kept.has(key);
  });
}

function readOverrides(adjustment: SizingAdjustment): Map<string, ConceptOverride> {
  const overrides = new Map<string, ConceptOverride>();
  if (!Array.isArray(adjustment.units)) return overrides;
  for (const entry of adjustment.units) {
    if (!entry || typeof entry.unit !== "string") continue;
    const current = overrides.get(entry.unit) ?? {};
    const concept = Array.isArray(entry.concepts) ? entry.concepts[0] : undefined;
    if (typeof concept === "string" && concept.length > 0) current.concept = concept;
    if (typeof entry.keyIdea === "string" && entry.keyIdea.length > 0) current.keyIdea = entry.keyIdea;
    if (current.concept || current.keyIdea) overrides.set(entry.unit, current);
  }
  return overrides;
}

function applyImportance(units: UnitFact[], adjustment: SizingAdjustment): void {
  if (!Array.isArray(adjustment.units)) return;
  for (const entry of adjustment.units) {
    if (!entry || typeof entry.unit !== "string") continue;
    if (typeof entry.importance !== "number" || !Number.isFinite(entry.importance)) continue;
    const factor = clamp(entry.importance, 0.5, 2);
    for (const unit of units) {
      if (unit.unit !== entry.unit) continue;
      unit.formulaValue = round1(unit.formulaValue * factor);
    }
  }
}

function applyUnskip(units: UnitFact[], adjustment: SizingAdjustment, skipped: SkippedFile[] | undefined): void {
  if (!Array.isArray(adjustment.unskip) || !Array.isArray(skipped)) return;
  const skippedByFile = new Map<string, SkippedFile>();
  for (const entry of skipped) {
    if (entry && typeof entry.file === "string" && !skippedByFile.has(entry.file)) {
      skippedByFile.set(entry.file, entry);
    }
  }
  const existingFiles = new Set(units.map((unit) => unit.file));
  const seen = new Set<string>();
  for (const file of adjustment.unskip) {
    if (typeof file !== "string" || seen.has(file)) continue;
    seen.add(file);
    const flagged = skippedByFile.get(file);
    if (!flagged || existingFiles.has(file)) continue;
    existingFiles.add(file);
    units.push({
      unit: fileBasename(file),
      file,
      language: "",
      kind: "function",
      startLine: 1,
      endLine: 1,
      lines: 1,
      signature: flagged.flag,
      code: "",
      branches: 0,
      loops: 0,
      recursive: false,
      stateChanges: 0,
      calls: [],
      callers: [],
      riskTags: [],
      mastery: 0.5,
      aiShare: 1,
      centrality: 0,
      logic: 1,
      risk: 1,
      formulaValue: 0.5,
    });
  }
}

export function applyAdjustment(
  units: UnitFact[],
  preset: CheckPreset,
  adjustment: SizingAdjustment,
  opts?: { skipped?: SkippedFile[] },
): { units: UnitFact[]; plan: DraftPlan; accepted: boolean } {
  const source = Array.isArray(units) ? units : [];
  const originalPlan = draftPlan(source, preset);
  const invalidUnits = !Array.isArray(units);
  const invalidAdjustment = adjustment == null || typeof adjustment !== "object" || Array.isArray(adjustment);
  if (invalidUnits || invalidAdjustment) {
    return { units: source, plan: originalPlan, accepted: true };
  }

  const adjusted = source.map(cloneUnit);
  applyImportance(adjusted, adjustment);
  applyUnskip(adjusted, adjustment, opts?.skipped);
  const concepts = readOverrides(adjustment);
  const candidate = draftPlan(adjusted, preset, {
    concepts,
    merge: adjustment.merge,
  });

  const budget = PRESET[preset]?.budget ?? originalPlan.estimatedSeconds;
  const overBudget = candidate.estimatedSeconds > budget && !isForcedSingleChoice(candidate);
  const tooManySlots = !slotCountAllowed(originalPlan.slots.length, candidate.slots.length);
  const droppedLogic = preset === "deep" && dropsSlottedLogic(source, originalPlan, candidate);
  if (overBudget || tooManySlots || droppedLogic) {
    return { units: source, plan: originalPlan, accepted: false };
  }
  return { units: adjusted, plan: candidate, accepted: true };
}
