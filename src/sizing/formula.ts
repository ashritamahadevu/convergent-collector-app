import type { RiskTag, Score, ScoreInput } from "./types";

/**
 * value(u) = L * (0.5 + C) * N * R * A
 *
 * L is structural logic from the tree-sitter walk, C is centrality,
 * N is 1 minus mastery, R is a risk multiplier, and A is the AI-written share.
 * Skipped files and student-written units (A = 0) score 0.
 * The published coalesce example is illustrative. This function is the
 * implementation the planner and the pause threshold both use.
 */

const RISK_BUMP: Record<RiskTag, number> = {
  memory: 0.15,
  recursion: 0.15,
  async: 0.1,
  auth: 0.15,
  sql: 0.15,
};

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function scoreUnit(input: ScoreInput): Score {
  const mastery = clamp(Number.isFinite(input.mastery) ? input.mastery : 0.5, 0, 1);
  const aiShare = clamp(Number.isFinite(input.aiShare) ? input.aiShare : 1, 0, 1);
  const novelty = round1(clamp(1 - mastery, 0, 1));
  let risk = 1;
  for (const tag of new Set(input.riskTags)) {
    risk += RISK_BUMP[tag] ?? 0;
  }
  risk = round1(clamp(risk, 1, 1.5));
  const centrality = round1(clamp(input.callerCount / 4, 0, 1));
  if (input.skipped || aiShare === 0) {
    return { logic: 0, centrality, novelty, risk, formulaValue: 0 };
  }
  const dense = input.lines > 0 && input.lines <= 3 && input.denseOps >= 2 ? 2 : 0;
  const logic = round1(
    input.branches +
      input.loops * 1.5 +
      (input.recursive ? 2 : 0) +
      input.stateChanges * 0.5 +
      Math.max(0, input.callsIntoChanged) +
      dense,
  );
  const formulaValue = round1(logic * (0.5 + centrality) * novelty * risk * aiShare);
  return { logic, centrality, novelty, risk, formulaValue };
}
