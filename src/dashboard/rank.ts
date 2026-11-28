/** Goblin rank from docs/goblin-rank.md. Quiet weeks do not move the stored stage. */

export type RankStage = "peasant" | "squire" | "knight" | "wizard" | "king";
export type RankStatName = "iq" | "range" | "recall" | "grit" | "streak" | "total";

export type RankStats = {
  iq: number;
  range: number;
  recall: number;
  grit: number;
  streak: number;
  total: number;
  followups: number;
};

export type RankSnapshot = {
  stage: RankStage;
  week: string;
  missed: RankStatName[];
  stats: RankStats;
};

const stages: RankStage[] = ["peasant", "squire", "knight", "wizard", "king"];
const DAY_MS = 24 * 60 * 60 * 1000;

const floors: Record<Exclude<RankStage, "peasant">, Partial<Record<RankStatName, number>> & { followups?: number }> = {
  squire: { iq: 35, grit: 50, streak: 20, total: 30 },
  knight: { iq: 55, range: 38, recall: 45, followups: 2, grit: 65, streak: 40, total: 50 },
  wizard: { iq: 70, range: 63, recall: 70, grit: 80, streak: 60, total: 70 },
  king: { iq: 90, range: 88, recall: 85, grit: 90, streak: 80, total: 90 },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number) => Math.round(value * 10) / 10;

export function weekKey(now: number): string {
  const date = new Date(now);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return utc.getUTCFullYear() + "-W" + String(week).padStart(2, "0");
}

export function rankStats(input: {
  mastery: number[];
  recall: { lastReview: number; stability: number; topic?: string }[];
  reviews: { groupId: string; occurredAt: number; outcome: string; source: string }[];
  now: number;
}): RankStats {
  const mastery = input.mastery.length ? input.mastery.reduce((sum, value) => sum + value, 0) / input.mastery.length : 0.2;
  const iq = round(clamp((mastery - 0.2) / 0.7, 0, 1) * 100);
  const range = round(Math.min(input.mastery.filter((value) => value >= 0.75).length, 8) / 8 * 100);
  const followups = input.reviews.filter((review) => review.source === "recall").length;
  const topicCards = input.recall.filter((card) => card.topic);
  const remembered = topicCards.length === 0 ? 0 : topicCards.reduce((sum, card) => {
    const elapsedDays = card.lastReview <= 0 ? 0 : Math.max(0, (input.now - card.lastReview) / DAY_MS);
    return sum + Math.exp(-elapsedDays / Math.max(card.stability, 0.1));
  }, 0) / topicCards.length;
  const recall = followups < 2 ? 50 : round(clamp(remembered / 0.9, 0, 1) * 100);
  const groups = new Map<string, { at: number; answered: boolean }>();
  for (const review of input.reviews) {
    const current = groups.get(review.groupId) ?? { at: 0, answered: false };
    current.at = Math.max(current.at, review.occurredAt);
    if (review.outcome === "pass" || review.outcome === "fail" || review.outcome === "disputed") current.answered = true;
    groups.set(review.groupId, current);
  }
  const ordered = [...groups.values()].sort((a, b) => b.at - a.at);
  const recent = ordered.slice(0, 20);
  const grit = recent.length === 0 ? 0 : round(recent.filter((group) => group.answered).length / recent.length * 100);
  let streakCount = 0;
  for (const group of ordered) {
    if (!group.answered || streakCount >= 10) break;
    streakCount += 1;
  }
  const streak = round(streakCount / 10 * 100);
  const total = round(iq * 0.3 + recall * 0.25 + range * 0.2 + grit * 0.15 + streak * 0.1);
  return { iq, range, recall, grit, streak, total, followups };
}

export function missedFloors(stage: RankStage, stats: RankStats): RankStatName[] {
  if (stage === "peasant") return [];
  const floor = floors[stage];
  const missed: RankStatName[] = [];
  for (const key of ["iq", "range", "recall", "grit", "streak", "total"] as const) {
    const required = floor[key];
    if (required !== undefined && stats[key] < required) missed.push(key);
  }
  if (floor.followups !== undefined && stats.followups < floor.followups) missed.push("recall");
  return [...new Set(missed)];
}

export function qualifiedStage(stats: RankStats): RankStage {
  let best: RankStage = "peasant";
  for (const stage of stages) {
    if (missedFloors(stage, stats).length === 0) best = stage;
  }
  return best;
}

/** Promote immediately. Demote only when the same floor is missed on two different active weeks. */
export function settleRank(stored: RankSnapshot | null, stats: RankStats, week: string, active: boolean): { stage: RankStage; snapshot: RankSnapshot | null } {
  if (!active) {
    return { stage: stored?.stage ?? qualifiedStage(stats), snapshot: null };
  }
  const qualified = qualifiedStage(stats);
  if (!stored || stages.indexOf(qualified) >= stages.indexOf(stored.stage)) {
    return { stage: qualified, snapshot: { stage: qualified, week, missed: [], stats } };
  }
  const missed = missedFloors(stored.stage, stats);
  const repeated = stored.week !== week && missed.some((floor) => stored.missed.includes(floor));
  if (repeated) return { stage: qualified, snapshot: { stage: qualified, week, missed: [], stats } };
  return { stage: stored.stage, snapshot: { stage: stored.stage, week, missed, stats } };
}
