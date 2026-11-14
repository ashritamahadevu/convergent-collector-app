import type { UnitFact } from "./types";

/** Tags used by Bayesian mastery and the review log. */
export type CanonicalConcept =
  | "control-flow"
  | "data-structures"
  | "mutation-aliasing"
  | "async-concurrency"
  | "error-handling"
  | "complexity"
  | "api-semantics"
  | "types"
  | "recursion"
  | "io";

export function canonicalConcept(
  unit: Pick<UnitFact, "riskTags" | "branches" | "loops" | "recursive" | "calls" | "stateChanges">,
): CanonicalConcept {
  if (unit.recursive || unit.riskTags.includes("recursion")) {
    return "recursion";
  }
  if (unit.riskTags.includes("async")) {
    return "async-concurrency";
  }
  if (unit.riskTags.includes("memory") || unit.stateChanges > 2) {
    return "mutation-aliasing";
  }
  if (unit.riskTags.includes("sql") || unit.riskTags.includes("auth") || unit.calls.length >= 3) {
    return "api-semantics";
  }
  if (unit.branches > 0 || unit.loops > 0) {
    return "control-flow";
  }
  return "control-flow";
}
