import type { RecallCard } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_EASE = 1.3;

export function newCard(concept: string, now: number, topic?: string): RecallCard {
  return {
    concept,
    topic,
    ease: 2.5,
    intervalDays: 0,
    repetitions: 0,
    dueAt: now,
    stability: 1,
    difficulty: 5,
    lastReview: 0,
  };
}

/** SM-2. A score of 0.8 or more counts as a successful review. */
export function reviewCard(card: RecallCard, score: number, now: number): RecallCard {
  const quality = scoreToQuality(score);
  let ease = card.ease;
  let repetitions = card.repetitions;
  let interval = card.intervalDays;

  if (quality < 3) {
    repetitions = 0;
    interval = 1;
  } else {
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.max(1, Math.round(interval * ease));
    }
    repetitions += 1;
    ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  }

  ease = Math.max(MIN_EASE, Math.round(ease * 100) / 100);
  const stability = Math.max(1, interval);
  return {
    concept: card.concept,
    topic: card.topic,
    ease,
    intervalDays: interval,
    repetitions,
    dueAt: now + interval * DAY_MS,
    stability,
    difficulty: Math.round((10 - Math.min(ease, 4)) * 10) / 10,
    lastReview: now,
  };
}

export function scoreToQuality(score: number): number {
  if (score >= 0.8) {
    return 5;
  }
  if (score >= 0.6) {
    return 4;
  }
  if (score >= 0.4) {
    return 3;
  }
  if (score >= 0.2) {
    return 2;
  }
  return 1;
}

/** Chance the student still recalls the concept. Computed, not stored. */
export function retrievability(card: RecallCard, now: number): number {
  if (card.lastReview <= 0) {
    return 0;
  }
  const elapsedDays = Math.max(0, (now - card.lastReview) / DAY_MS);
  const stability = Math.max(card.stability, 0.1);
  return Math.exp(-elapsedDays / stability);
}

export function isDue(card: RecallCard, now: number): boolean {
  return card.dueAt <= now;
}
