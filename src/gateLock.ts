import { normPath } from "./agentProtocol";

/**
 * Coordinates the inline guard and the agent guard so one disk write does
 * not open two quizzes, without dropping a later edit to the same file.
 */

const claims = new Map<string, number>();
const holds = new Map<string, number>();
const coverage = new Map<string, { snippet: string; until: number }>();

export function claimPath(fsPath: string, ms: number): void {
  const key = normPath(fsPath);
  claims.set(key, Math.max(claims.get(key) ?? 0, Date.now() + ms));
}

export function holdPath(fsPath: string): void {
  const key = normPath(fsPath);
  holds.set(key, (holds.get(key) ?? 0) + 1);
}

export function releasePath(fsPath: string): void {
  const key = normPath(fsPath);
  const next = (holds.get(key) ?? 1) - 1;
  if (next <= 0) {
    holds.delete(key);
    claimPath(key, 800);
  } else {
    holds.set(key, next);
  }
}

export function isAgentClaimed(fsPath: string): boolean {
  const key = normPath(fsPath);
  if ((holds.get(key) ?? 0) > 0) {
    return true;
  }
  const until = claims.get(key) ?? 0;
  if (until < Date.now()) {
    claims.delete(key);
    return false;
  }
  return true;
}

/** Remember a quiz the inline guard already started for this insertion. */
export function markEditorGate(fsPath: string, snippet: string): void {
  const key = normPath(fsPath);
  // Short claim so a duplicate disk event does not open a second quiz.
  // A later, different edit is not blocked once this window passes.
  claimPath(key, 1500);
  coverage.set(key, { snippet, until: Date.now() + 3000 });
}

export function isCoveredByEditorGate(fsPath: string, snippet: string): boolean {
  const rec = coverage.get(normPath(fsPath));
  if (!rec || rec.until < Date.now()) {
    return false;
  }
  return snippetsMatch(rec.snippet, snippet);
}

export function snippetsMatch(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < 20) {
    return false;
  }
  return longer.includes(shorter);
}

/** Test helper. */
export function resetGateLock(): void {
  claims.clear();
  holds.clear();
  coverage.clear();
}
