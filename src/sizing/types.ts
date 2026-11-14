/**
 * Local half of the DrawBridge hybrid check.
 *
 * Tree-sitter turns each changed file into unit fact sheets. A formula scores
 * those units and drafts a question plan. The pause gate holds the agent's
 * next mutating tool until the student answers that plan. A model may later
 * adjust importance, but only inside the limits in `applyLimits`.
 */

export type CheckPreset = "quick" | "standard" | "deep";

export type QuestionType =
  | "multiple_choice"
  | "ordering"
  | "predict"
  | "explain"
  | "change";

export type RiskTag = "memory" | "recursion" | "async" | "auth" | "sql";

export type UnitKind = "function" | "method" | "class";

/** One function, method, or class the analyzer found. */
export type UnitFact = {
  unit: string;
  file: string;
  language: string;
  kind: UnitKind;
  /** 1-based inclusive line range in the file. */
  startLine: number;
  endLine: number;
  lines: number;
  signature: string;
  /** Exact source of the unit, without added line numbers. */
  code: string;
  branches: number;
  loops: number;
  recursive: boolean;
  stateChanges: number;
  /** Names this unit calls, in source order, duplicates removed. */
  calls: string[];
  /** Other units in the same analysis batch that call this one. */
  callers: string[];
  riskTags: RiskTag[];
  /** Bayesian mastery for the unit's concepts. Unknown concepts use 0.5. */
  mastery: number;
  /** Share of the unit the student did not write. Agent output uses 1. */
  aiShare: number;
  /** 0 to 1. How many other units call this one. */
  centrality: number;
  /** L in value = L * (0.5 + C) * N * R * A. Zero when the file is skipped. */
  logic: number;
  /** R, from 1 to 1.5. */
  risk: number;
  formulaValue: number;
};

export type SkippedFile = {
  file: string;
  /** One line, for example "template with if-tags" or "config". */
  flag: string;
};

export type FileAnalysis = {
  file: string;
  language: string | null;
  skipped: SkippedFile | null;
  units: UnitFact[];
};

/** Numbers the formula needs. The analyzer fills these from the syntax tree. */
export type ScoreInput = {
  lines: number;
  branches: number;
  loops: number;
  recursive: boolean;
  stateChanges: number;
  /** Calls whose names are other changed units. */
  callsIntoChanged: number;
  callerCount: number;
  riskTags: RiskTag[];
  mastery: number;
  aiShare: number;
  /** Markup, styles, config, lockfiles, and generated files force logic to 0. */
  skipped: boolean;
  /** Bitwise, shift, or nested-ternary operators. Lifts a dense one-liner. */
  denseOps: number;
};

export type Score = {
  logic: number;
  centrality: number;
  novelty: number;
  risk: number;
  /** One decimal place. */
  formulaValue: number;
};

export type PlanSlot = {
  type: QuestionType;
  unit: string;
  file: string;
  concept: string;
  keyIdea: string;
  points: number;
  estimatedSeconds: number;
};

export type DraftPlan = {
  preset: CheckPreset;
  slots: PlanSlot[];
  /** 1, or more when the preset cannot finish in one sitting. */
  sessions: number;
  estimatedSeconds: number;
  /** 0 to 1. Covered points divided by total formula value. */
  coverage: number;
  totalValue: number;
};

export type SizingAdjustment = {
  units?: {
    unit: string;
    /** Multiplier on formulaValue. The planner clamps it to 0.5..2. */
    importance?: number;
    concepts?: string[];
    keyIdea?: string;
  }[];
  merge?: string[][];
  /** Only names that were in the skipped-file list may be un-skipped. */
  unskip?: string[];
};

export type CheckpointState = {
  sessionId: string;
  preset: CheckPreset;
  uncleared: UnitFact[];
  /** Fingerprints already passed or bypassed in this session. */
  cleared: string[];
};

export type IncomingTool = {
  toolName: string;
  /** True when this tool can write or delete project files, including a shell. */
  mutating: boolean;
  filePath?: string;
};

export type PauseReason =
  | "continue"
  | "checkpoint"
  | "passed"
  | "failed"
  | "bypass"
  | "no-editor"
  | "not-mutating"
  | "below-threshold";

export type PauseDecision = {
  allow: boolean;
  reason: PauseReason;
  userMessage: string;
  agentMessage: string;
  units: UnitFact[];
  plan: DraftPlan | null;
};

/** A question the extension can grade with no model call. */
export type LocalQuestion = {
  type: "multiple_choice" | "ordering";
  prompt: string;
  unit: string;
  file: string;
  concept: string;
  options: string[];
  /** Correct option index, or the correct order of indexes into `options`. */
  answer: number | number[];
  hint: string;
  explanation: string;
  /** Source of the unit, so the quiz engine can ask about the real code. */
  code?: string;
  /** Question type chosen by the chunk policy, before local fallback. */
  requestedKind?: QuestionType;
};

export type HookAgent = "claude-code" | "codex" | "cursor" | "unknown";
