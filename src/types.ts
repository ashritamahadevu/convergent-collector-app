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
  kind: "free-text" | "multiple-choice";
  question: string;
  referenceAnswer: string;   // hidden from the student
  criteria: Criterion[];     // free-text only; 2-6 atomic binary items
  options?: string[];        // MCQ only
  correctIndex?: number;     // MCQ only
  conceptTags: string[];
  flagged?: boolean;
};
export type CriterionVerdict = { id: string; verdict: "pass" | "fail" | "n/a"; evidence: string };
export type JudgeResult =
  | { kind: "decided"; verdicts: CriterionVerdict[] }
  | { kind: "no_decision"; reason: string };
export type Provider = "openai" | "anthropic" | "gemini" | "ollama";
export type GradingMode = "free-text" | "multiple-choice";
export type AttemptRecord = {
  timestamp: number;
  language: string;
  charCount: number;
  mode: GradingMode;
  conceptTags: string[];
  criterionResults?: { id: string; verdict: "pass" | "fail" | "n/a" }[];
  passed: boolean;
  followups: number;
  judgeConfigId: string;
  appealed?: boolean;
};
