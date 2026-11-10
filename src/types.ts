export type Criterion = {
  id: string;
  text: string;
  /** Shown on a miss. Points at the code without stating the outcome. */
  hint?: string;
  critical: boolean;
  optional?: boolean;
  negative?: boolean;
};
export type GeneratedQuestion = {
  kind: QuestionKind;
  question: string;
  referenceAnswer: string;   // hidden from the student
  criteria: Criterion[];     // free-text only; 2-6 atomic binary items
  options?: string[];        // MCQ only
  correctIndex?: number;     // MCQ only
  items?: string[];          // ordering, shown shuffled
  correctOrder?: number[];   // ordering, indexes into items
  buggyCode?: string;        // debug: planted in the editor
  conceptTags: string[];
  flagged?: boolean;
};
export type CriterionVerdict = { id: string; verdict: "pass" | "fail" | "n/a"; evidence: string };
export type JudgeResult =
  | { kind: "decided"; verdicts: CriterionVerdict[]; misconception?: string }
  | { kind: "no_decision"; reason: string };
export type Provider =
  | "openai"
  | "anthropic"
  | "gemini"
  | "ollama"
  | "claude-cli"
  | "cursor-cli"
  | "codex-cli"
  | "gemini-cli"
  | "copilot-cli";
export type GradingMode = "free-text" | "multiple-choice";
export type GuardMode = "auto" | "learn" | "walkthrough";
export type QuestionKind = "free-text" | "multiple-choice" | "ordering" | "debug";
/** Bypass is stored but excluded from the pass rate. Disputed counts as correct. */
export type AttemptOutcome = "pass" | "fail" | "bypass" | "disputed" | "explained";
export type AttemptSource = "paste" | "inline" | "agent" | "recall" | "walkthrough";
export type AttemptRecord = {
  timestamp: number;
  language: string;
  charCount: number;
  mode: GradingMode;
  conceptTags: string[];
  criterionResults?: { id: string; verdict: "pass" | "fail" | "n/a" }[];
  passed: boolean;
  outcome?: AttemptOutcome;
  followups: number;
  judgeConfigId: string;
  appealed?: boolean;
  /** 0 to 1 evidence the student understood the concept, after judge-bias discount. */
  score?: number;
  source?: AttemptSource;
  filePath?: string;
  misconceptions?: string[];
};
export type ConceptMastery = {
  concept: string;
  mastery: number;
  elo: number;
  attempts: number;
  lastSeen: number;
};
export type RecallCard = {
  concept: string;
  ease: number;
  intervalDays: number;
  repetitions: number;
  dueAt: number;
  stability: number;
  difficulty: number;
  lastReview: number;
};
export type ProfileFacts = {
  examDate?: string;
  interviewDate?: string;
  preferredLanguage?: string;
  strictness?: string;
};
export type FileKnowledge = {
  path: string;
  concepts: string[];
  passed: boolean;
  aiWritten: boolean;
  core?: boolean;
  complexity?: number;
  centrality?: number;
  updatedAt: number;
};
export type MisgradeReport = {
  timestamp: number;
  language: string;
  question: string;
  studentAnswer: string;
  feedback: string;
  snippetPreview: string;
  conceptTags: string[];
  judgeConfigId: string;
};
