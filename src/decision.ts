import type { Criterion, CriterionVerdict, GeneratedQuestion } from "./types";

export type Outcome = "pass" | "borderline" | "fail";

export type PreCheck = {
  kind: "copy-back" | "injection" | "too-short";
  blocking: boolean;
  message: string;
};

const COPY_BACK_JACCARD_THRESHOLD = 0.8;

const INJECTION_MARKERS = [
  "ignore previous",
  "mark as pass",
  "system:",
];

function wordTokenSet(text: string): Set<string> {
  const tokens = text.toLowerCase().split(/\W+/).filter((t) => t.length > 0);
  return new Set(tokens);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection++;
    }
  }
  const union = a.size + b.size - intersection;
  if (union === 0) {
    return 0;
  }
  return intersection / union;
}

export function runPreChecks(
  studentAnswer: string,
  snippet: string,
  minAnswerLength: number,
): PreCheck[] {
  const checks: PreCheck[] = [];

  if (studentAnswer.trim().length < minAnswerLength) {
    checks.push({
      kind: "too-short",
      blocking: true,
      message: `Answer is shorter than the minimum length (${minAnswerLength} characters).`,
    });
  }

  const answerTokens = wordTokenSet(studentAnswer);
  const snippetTokens = wordTokenSet(snippet);
  const overlap = jaccardSimilarity(answerTokens, snippetTokens);
  if (overlap >= COPY_BACK_JACCARD_THRESHOLD) {
    checks.push({
      kind: "copy-back",
      blocking: true,
      message:
        "Answer closely restates the code snippet; explain behavior in your own words.",
    });
  }

  const lowerAnswer = studentAnswer.toLowerCase();
  for (const marker of INJECTION_MARKERS) {
    if (lowerAnswer.includes(marker)) {
      checks.push({
        kind: "injection",
        blocking: false,
        message: `Answer contains a suspicious phrase (${JSON.stringify(marker)}); logged for review.`,
      });
      break;
    }
  }

  return checks;
}

// Resolve verdict per criterion by id. Missing verdict: critical -> "fail", non-critical -> "n/a".
function resolveVerdict(
  criterion: Criterion,
  verdictById: Map<string, CriterionVerdict["verdict"]>,
): CriterionVerdict["verdict"] {
  const found = verdictById.get(criterion.id);
  if (found !== undefined) {
    return found;
  }
  return criterion.critical ? "fail" : "n/a";
}

export function aggregate(
  criteria: Criterion[],
  verdicts: CriterionVerdict[],
  nonCriticalPassFraction: number,
): { outcome: Outcome; missed: Criterion[] } {
  const verdictById = new Map<string, CriterionVerdict["verdict"]>();
  for (const v of verdicts) {
    verdictById.set(v.id, v.verdict);
  }

  const resolved = criteria.map((c) => ({
    criterion: c,
    verdict: resolveVerdict(c, verdictById),
  }));

  const criticalResolved = resolved.filter((r) => r.criterion.critical);
  const allCriticalPass = criticalResolved.every((r) => r.verdict === "pass");

  const nonCritical = resolved.filter(
    (r) => !r.criterion.critical && r.verdict !== "n/a",
  );
  const passedNonCritical = nonCritical.filter((r) => r.verdict === "pass").length;
  const nonCriticalRate =
    nonCritical.length === 0 ? 1 : passedNonCritical / nonCritical.length;

  const anyPass = resolved.some((r) => r.verdict === "pass");

  const missed = resolved
    .filter((r) => r.verdict === "fail")
    .map((r) => r.criterion);

  let outcome: Outcome;
  if (allCriticalPass && nonCriticalRate >= nonCriticalPassFraction) {
    outcome = "pass";
  } else if (!allCriticalPass && !anyPass) {
    outcome = "fail";
  } else {
    outcome = "borderline";
  }

  return { outcome, missed };
}

export function gradeMcq(question: GeneratedQuestion, selectedIndex: number): boolean {
  return selectedIndex === question.correctIndex;
}
