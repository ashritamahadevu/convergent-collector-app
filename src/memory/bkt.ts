export type BktParams = {
  prior: number;
  learn: number;
  slip: number;
  guess: number;
};

export const DEFAULT_BKT: BktParams = {
  prior: 0.2,
  learn: 0.15,
  slip: 0.1,
  guess: 0.05,
};

/** Guess rate for a one-correct-option question with about four choices. */
export const MCQ_GUESS = 0.25;

/** Default grader false-fail and false-pass rates until a gold set measures them. */
export const DEFAULT_FALSE_FAIL = 0.1;
export const DEFAULT_FALSE_PASS = 0.25;

export function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * A free-response pass is weaker evidence when the grader is lenient, and a
 * fail is weaker evidence when the grader marks good answers wrong.
 */
export function discountJudgeScore(
  passed: boolean,
  falseFail = DEFAULT_FALSE_FAIL,
  falsePass = DEFAULT_FALSE_PASS,
): number {
  return passed ? clamp01(1 - falsePass) : clamp01(falseFail);
}

/**
 * Bayes update on the hidden "knows it" state, then a learning transition.
 * `score` is 0 to 1 and blends the correct and incorrect posteriors.
 */
export function nextMastery(mastery: number, score: number, params: BktParams): number {
  const pL = clamp01(mastery);
  const slip = Math.min(Math.max(params.slip, 0), 0.1);
  const guess = Math.min(Math.max(params.guess, 0), 0.3);
  const learn = Math.min(Math.max(params.learn, 0), 0.5);
  const s = clamp01(score);

  const pCorrect = pL * (1 - slip) + (1 - pL) * guess;
  const pWrong = pL * slip + (1 - pL) * (1 - guess);
  const givenCorrect = pCorrect <= 0 ? pL : (pL * (1 - slip)) / pCorrect;
  const givenWrong = pWrong <= 0 ? pL : (pL * slip) / pWrong;
  const given = s * givenCorrect + (1 - s) * givenWrong;
  return clamp01(given + (1 - given) * learn);
}

/** Relative ability. A surprising score moves the rating more. */
export function nextElo(ability: number, score: number): number {
  const expected = 1 / (1 + 10 ** ((1000 - ability) / 400));
  const next = ability + 32 * (clamp01(score) - expected);
  return Math.round(next * 10) / 10;
}
