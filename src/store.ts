import * as vscode from "vscode";
import type { AttemptRecord, MisgradeReport } from "./types";

export const STORE_KEY = "comprehensionGuard.attempts";
export const MISGRADE_KEY = "comprehensionGuard.misgradeReports";

/** Most recent records kept in globalState; older entries are dropped on append. */
const MAX_ATTEMPTS = 1000;

export function getAttempts(context: vscode.ExtensionContext): AttemptRecord[] {
  const raw = context.globalState.get<AttemptRecord[]>(STORE_KEY, []);
  return Array.isArray(raw) ? raw : [];
}

export async function addAttempt(
  context: vscode.ExtensionContext,
  record: AttemptRecord,
): Promise<void> {
  const prev = getAttempts(context);
  let next = [...prev, record];
  if (next.length > MAX_ATTEMPTS) {
    next = next.slice(next.length - MAX_ATTEMPTS);
  }
  await context.globalState.update(STORE_KEY, next);
}

export type Stats = {
  total: number;
  passed: number;
  passRate: number;
  byConcept: Record<string, { total: number; passed: number }>;
  mostMissed: string[];
};

export function getStats(context: vscode.ExtensionContext): Stats {
  const attempts = getAttempts(context).filter(
    (a) => a.outcome !== "bypass" && a.outcome !== "explained",
  );
  const total = attempts.length;
  const passed = attempts.filter((a) => a.passed).length;
  const passRate = total === 0 ? 0 : passed / total;

  const byConcept: Record<string, { total: number; passed: number }> = {};

  for (const attempt of attempts) {
    for (const tag of attempt.conceptTags) {
      const entry = byConcept[tag] ?? { total: 0, passed: 0 };
      entry.total += 1;
      if (attempt.passed) {
        entry.passed += 1;
      }
      byConcept[tag] = entry;
    }
  }

  const mostMissed = Object.entries(byConcept)
    .filter(([, stats]) => stats.total > 0)
    .sort(([, a], [, b]) => {
      const rateA = a.passed / a.total;
      const rateB = b.passed / b.total;
      if (rateA !== rateB) {
        return rateA - rateB;
      }
      return b.total - a.total;
    })
    .slice(0, 5)
    .map(([tag]) => tag);

  return {
    total,
    passed,
    passRate,
    byConcept,
    mostMissed,
  };
}

export async function saveMisgradeReport(
  context: vscode.ExtensionContext,
  report: MisgradeReport,
): Promise<{ sent: boolean; detail: string }> {
  const prev = context.globalState.get<MisgradeReport[]>(MISGRADE_KEY, []);
  const next = [...(Array.isArray(prev) ? prev : []), report].slice(-200);
  await context.globalState.update(MISGRADE_KEY, next);

  const url = vscode.workspace
    .getConfiguration("comprehensionGuard")
    .get<string>("misgradeReportUrl", "")
    .trim();
  if (!url) {
    return {
      sent: false,
      detail: "Saved on this computer. Set comprehensionGuard.misgradeReportUrl to send reports to the team.",
    };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });
    if (!response.ok) {
      return { sent: false, detail: "Saved locally. The report URL returned " + response.status + "." };
    }
    return { sent: true, detail: "Misgrade report sent." };
  } catch {
    return { sent: false, detail: "Saved locally. The report URL could not be reached." };
  }
}
