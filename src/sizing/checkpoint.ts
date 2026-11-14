import type { CheckPreset, CheckpointState, UnitFact } from "./types";

/**
 * Pause checkpoint for one comprehension session.
 * Uncleared units accumulate until their formula value crosses the preset
 * threshold. Clearing a fingerprint keeps that unit from coming back.
 */

const PAUSE_THRESHOLD: Record<CheckPreset, number> = {
  // Novelty defaults to 0.5, so a two-branch function is about 0.5.
  // Quick waits for several of those. Standard pauses on the first one.
  // Deep pauses on any unit that has logic.
  quick: 2,
  standard: 0.5,
  deep: 0.1,
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function ignored(unit: UnitFact): boolean {
  return unit.logic <= 0 || unit.formulaValue <= 0;
}

export function emptyCheckpoint(sessionId: string, preset: CheckPreset): CheckpointState {
  return {
    sessionId,
    preset,
    uncleared: [],
    cleared: [],
  };
}

export function unitFingerprint(unit: UnitFact): string {
  return `${unit.file}:${unit.unit}:${unit.startLine}:${unit.endLine}`;
}

export function noteUnits(state: CheckpointState, units: UnitFact[]): CheckpointState {
  const cleared = new Set(state.cleared);
  const order: string[] = [];
  const byFingerprint = new Map<string, UnitFact>();

  const keep = (unit: UnitFact) => {
    if (ignored(unit)) return;
    const fingerprint = unitFingerprint(unit);
    if (cleared.has(fingerprint)) return;
    if (!byFingerprint.has(fingerprint)) order.push(fingerprint);
    byFingerprint.set(fingerprint, unit);
  };

  for (const unit of state.uncleared) keep(unit);
  for (const unit of units) keep(unit);

  return {
    sessionId: state.sessionId,
    preset: state.preset,
    uncleared: order.map((fingerprint) => byFingerprint.get(fingerprint) as UnitFact),
    cleared: [...state.cleared],
  };
}

export function pauseThreshold(preset: CheckPreset): number {
  return PAUSE_THRESHOLD[preset];
}

export function unclearedValue(state: CheckpointState): number {
  const total = state.uncleared.reduce((sum, unit) => sum + unit.formulaValue, 0);
  return round1(total);
}

export function needsCheckpoint(state: CheckpointState): boolean {
  const hasLogic = state.uncleared.some((unit) => unit.logic > 0);
  return hasLogic && unclearedValue(state) >= pauseThreshold(state.preset);
}

export function clearUnits(state: CheckpointState, units: UnitFact[]): CheckpointState {
  const removing = units.map(unitFingerprint);
  const drop = new Set(removing);
  const cleared = [...state.cleared];
  const seen = new Set(cleared);
  for (const fingerprint of removing) {
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    cleared.push(fingerprint);
  }
  return {
    sessionId: state.sessionId,
    preset: state.preset,
    uncleared: state.uncleared.filter((unit) => !drop.has(unitFingerprint(unit))),
    cleared,
  };
}
