/** Shared by the extension and desktop receiver. No VS Code/Electron imports. */

export type CheckOutcome = "pass" | "fail" | "bypass" | "explained" | "disputed" | "ungraded";
export type CheckShape = "general" | "chunk";

type Envelope = {
  schemaVersion: 1;
  eventId: string;
  installationId: string;
  occurredAt: number;
};

export type ReviewEvent = Envelope & {
  type: "review.recorded";
  project: { id: string; name: string };
  concepts: string[];
  topic: string;
  question: string;
  answer: string;
  feedback: string;
  misconception: string;
  outcome: CheckOutcome;
  /** Actual assessment result, 0..1. null means no assessment score. */
  score: number | null;
  source: string;
  mode: string;
  shape: CheckShape;
  groupId: string;
  filePath: string | null;
  retries: number;
  masteryAfter: number | null;
};

export type MasteryEvent = Envelope & {
  type: "mastery.updated";
  concept: string;
  mastery: number;
  elo: number;
  attempts: number;
  lastSeen: number;
};

export type RecallEvent = Envelope & {
  type: "recall.updated";
  concept: string;
  topic?: string;
  ease: number;
  intervalDays: number;
  repetitions: number;
  dueAt: number;
  stability: number;
  difficulty: number;
  lastReview: number;
};

export type FileEvent = Envelope & {
  type: "file.updated";
  path: string;
  concepts: string[];
  topic: string;
  passed: boolean;
  aiWritten: boolean;
  core: boolean;
  complexity: number | null;
  centrality: number | null;
  updatedAt: number;
};

export type FileEdgesEvent = Envelope & {
  type: "file.edges";
  fromPath: string;
  edges: { toPath: string; kind: "call" | "import" }[];
};

export type ProfileEvent = Envelope & {
  type: "profile.updated";
  examDate?: string;
  interviewDate?: string;
  preferredLanguage?: string;
  strictness?: string;
};

export type PrepQuestion = {
  question: string;
  referenceAnswer: string;
  conceptTags: string[];
  excerpt: string;
  path: string;
};

export type PrepSetEvent = Envelope & {
  type: "prepset.created";
  kind: "interview" | "exam";
  project: string;
  questions: PrepQuestion[];
};

/** Student-facing settings only. API keys and the desktop-sync toggle stay on the machine. */
export type SettingsEvent = Envelope & {
  type: "settings.updated";
  updatedAt: number;
  enabled: boolean;
  charThreshold: number;
  minAnswerLength: number;
  provider: string;
  model: string;
  gradingMode: string;
  nonCriticalPassFraction: number;
  mode: string;
  walkthroughFileThreshold: number;
  walkthroughLineThreshold: number;
  maxFollowups: number;
  agentPause: boolean;
  checkPreset: string;
  preferredLanguage: string;
  strictness: string;
  examDate: string;
  interviewDate: string;
};

export type DashboardEvent =
  | ReviewEvent
  | MasteryEvent
  | RecallEvent
  | FileEvent
  | FileEdgesEvent
  | ProfileEvent
  | PrepSetEvent
  | SettingsEvent;

const outcomes = new Set(["pass", "fail", "bypass", "explained", "disputed", "ungraded"]);
const shapes = new Set(["general", "chunk"]);
const providers = new Set(["openai", "anthropic", "gemini", "ollama", "claude-cli", "cursor-cli", "codex-cli", "gemini-cli", "copilot-cli"]);
const gradingModes = new Set(["free-text", "multiple-choice"]);
const modes = new Set(["auto", "learn", "walkthrough"]);
const presets = new Set(["quick", "standard", "deep"]);
const strictnessLevels = new Set(["lenient", "standard", "strict"]);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const unit = (v: unknown): v is number => finite(v) && v >= 0 && v <= 1;
const stamp = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

/** Workspace-relative paths only. Absolute paths and parent traversal stay on the machine. */
export function isRelativePath(value: string): boolean {
  return value.length > 0
    && value.length <= 2000
    && !value.startsWith("/")
    && !/^[A-Za-z]:/.test(value)
    && !value.split(/[\\/]/).includes("..");
}

function envelope(v: Record<string, unknown>): boolean {
  return v.schemaVersion === 1
    && str(v.eventId, 100) && v.eventId.length > 0
    && str(v.installationId, 100) && v.installationId.length > 0
    && stamp(v.occurredAt);
}

function concepts(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= 100 && v.every((item) => str(item, 200));
}

function scoreOrNull(v: unknown, outcome: string): boolean {
  const ok = v === null || unit(v);
  if (!ok) return false;
  return !["bypass", "explained", "ungraded"].includes(outcome) || v === null;
}

export function isReviewEvent(v: unknown): v is ReviewEvent {
  if (!object(v) || v.type !== "review.recorded" || !envelope(v)) return false;
  if (!object(v.project) || !str(v.project.id, 128) || !v.project.id || !str(v.project.name, 500)) return false;
  return concepts(v.concepts)
    && str(v.topic, 200)
    && str(v.question, 20000)
    && str(v.answer, 20000)
    && str(v.feedback, 20000)
    && str(v.misconception, 2000)
    && typeof v.outcome === "string" && outcomes.has(v.outcome)
    && scoreOrNull(v.score, v.outcome)
    && str(v.source, 100)
    && str(v.mode, 100)
    && typeof v.shape === "string" && shapes.has(v.shape)
    && str(v.groupId, 100) && v.groupId.length > 0
    && (v.filePath === null || (str(v.filePath, 2000) && isRelativePath(v.filePath)))
    && Number.isSafeInteger(v.retries) && (v.retries as number) >= 0
    && (v.masteryAfter === null || unit(v.masteryAfter));
}

export function isMasteryEvent(v: unknown): v is MasteryEvent {
  if (!object(v) || v.type !== "mastery.updated" || !envelope(v)) return false;
  return str(v.concept, 200) && v.concept.length > 0
    && unit(v.mastery)
    && finite(v.elo)
    && Number.isSafeInteger(v.attempts) && (v.attempts as number) >= 0
    && stamp(v.lastSeen);
}

export function isRecallEvent(v: unknown): v is RecallEvent {
  if (!object(v) || v.type !== "recall.updated" || !envelope(v)) return false;
  return str(v.concept, 200) && v.concept.length > 0
    && (v.topic === undefined || str(v.topic, 200))
    && finite(v.ease) && v.ease > 0
    && Number.isSafeInteger(v.intervalDays) && (v.intervalDays as number) >= 0
    && Number.isSafeInteger(v.repetitions) && (v.repetitions as number) >= 0
    && stamp(v.dueAt)
    && finite(v.stability) && v.stability > 0
    && finite(v.difficulty)
    && stamp(v.lastReview);
}

export function isFileEvent(v: unknown): v is FileEvent {
  if (!object(v) || v.type !== "file.updated" || !envelope(v)) return false;
  return str(v.path, 2000) && isRelativePath(v.path)
    && concepts(v.concepts)
    && str(v.topic, 200)
    && typeof v.passed === "boolean"
    && typeof v.aiWritten === "boolean"
    && typeof v.core === "boolean"
    && (v.complexity === null || finite(v.complexity))
    && (v.centrality === null || unit(v.centrality))
    && stamp(v.updatedAt);
}

export function isFileEdgesEvent(v: unknown): v is FileEdgesEvent {
  if (!object(v) || v.type !== "file.edges" || !envelope(v)) return false;
  if (!str(v.fromPath, 2000) || !isRelativePath(v.fromPath)) return false;
  return Array.isArray(v.edges) && v.edges.length <= 200 && v.edges.every((edge) =>
    object(edge) && str(edge.toPath, 2000) && isRelativePath(edge.toPath) && (edge.kind === "call" || edge.kind === "import"),
  );
}

export function isProfileEvent(v: unknown): v is ProfileEvent {
  if (!object(v) || v.type !== "profile.updated" || !envelope(v)) return false;
  const optional = (value: unknown) => value === undefined || str(value, 200);
  return optional(v.examDate) && optional(v.interviewDate) && optional(v.preferredLanguage) && optional(v.strictness);
}

export function isPrepSetEvent(v: unknown): v is PrepSetEvent {
  if (!object(v) || v.type !== "prepset.created" || !envelope(v)) return false;
  if ((v.kind !== "interview" && v.kind !== "exam") || !str(v.project, 500)) return false;
  return Array.isArray(v.questions) && v.questions.length <= 50 && v.questions.every((item) =>
    object(item)
    && str(item.question, 20000)
    && str(item.referenceAnswer, 20000)
    && concepts(item.conceptTags)
    && str(item.excerpt, 2000)
    && str(item.path, 2000)
    && isRelativePath(item.path),
  );
}

function atLeast(v: unknown, min: number): v is number {
  return finite(v) && v >= min;
}

export function isSettingsEvent(v: unknown): v is SettingsEvent {
  if (!object(v) || v.type !== "settings.updated" || !envelope(v) || !stamp(v.updatedAt)) return false;
  return typeof v.enabled === "boolean"
    && atLeast(v.charThreshold, 1)
    && atLeast(v.minAnswerLength, 0)
    && typeof v.provider === "string" && providers.has(v.provider)
    && str(v.model, 200)
    && typeof v.gradingMode === "string" && gradingModes.has(v.gradingMode)
    && unit(v.nonCriticalPassFraction)
    && typeof v.mode === "string" && modes.has(v.mode)
    && atLeast(v.walkthroughFileThreshold, 2)
    && atLeast(v.walkthroughLineThreshold, 1)
    && atLeast(v.maxFollowups, 1)
    && typeof v.agentPause === "boolean"
    && typeof v.checkPreset === "string" && presets.has(v.checkPreset)
    && str(v.preferredLanguage, 200)
    && typeof v.strictness === "string" && strictnessLevels.has(v.strictness)
    && str(v.examDate, 200)
    && str(v.interviewDate, 200);
}

export function isDashboardEvent(v: unknown): v is DashboardEvent {
  return isReviewEvent(v)
    || isMasteryEvent(v)
    || isRecallEvent(v)
    || isFileEvent(v)
    || isFileEdgesEvent(v)
    || isProfileEvent(v)
    || isPrepSetEvent(v)
    || isSettingsEvent(v);
}

export function localEndpoint(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) throw new Error("Use http://127.0.0.1:PORT only.");
  return url.origin;
}
