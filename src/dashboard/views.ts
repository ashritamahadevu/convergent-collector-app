/** Read models derived from saved reviews; these do not change the event format. */
export type ProjectSummary = {
  id: string;
  name: string;
  lastActivityAt: number;
  totalChecks: number;
  scoredChecks: number;
  unscoredChecks: number;
  averageScoreOutOfFive: number | null;
};

export type WeakPoint = {
  concept: string;
  averageScore: number;
  scoredChecks: number;
  filePath: string | null;
  project: { id: string; name: string };
};
export type HomeSummary = {
  recentChecks: import("./protocol").ReviewEvent[];
  weakPoints: WeakPoint[];
};

export function isProjectId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

export function isProjectSummary(value: unknown): value is ProjectSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as ProjectSummary;
  const count = (n: number) => Number.isSafeInteger(n) && n >= 0;
  return isProjectId(p.id) && typeof p.name === "string" && p.name.length <= 500 &&
    count(p.lastActivityAt) && count(p.totalChecks) && p.totalChecks > 0 &&
    count(p.scoredChecks) && count(p.unscoredChecks) &&
    p.scoredChecks + p.unscoredChecks === p.totalChecks &&
    (p.scoredChecks === 0 ? p.averageScoreOutOfFive === null :
      typeof p.averageScoreOutOfFive === "number" && Number.isFinite(p.averageScoreOutOfFive) &&
      p.averageScoreOutOfFive >= 0 && p.averageScoreOutOfFive <= 5);
}
