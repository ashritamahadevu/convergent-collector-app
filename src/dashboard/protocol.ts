/** Shared by the extension and desktop receiver. No VS Code/Electron imports. */
export type CheckOutcome = "pass" | "fail" | "bypass" | "explained" | "disputed" | "ungraded";
export type CheckEvent = {
  schemaVersion: 1;
  type: "check.recorded";
  eventId: string;
  installationId: string;
  occurredAt: number;
  project: { id: string; name: string };
  check: {
    concepts: string[];
    question: string;
    answer: string;
    feedback: string;
    misconception: string;
    outcome: CheckOutcome;
    /** Actual assessment result, 0..1. null means no assessment score. */
    score: number | null;
    source: string;
    mode: string;
    filePath: string | null;
    retries: number;
  };
};

const outcomes = new Set(["pass", "fail", "bypass", "explained", "disputed", "ungraded"]);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
export function isCheckEvent(v: unknown): v is CheckEvent {
  if (!object(v) || v.schemaVersion !== 1 || v.type !== "check.recorded" ||
      !str(v.eventId, 100) || !v.eventId || !str(v.installationId, 100) || !v.installationId ||
      !Number.isSafeInteger(v.occurredAt) || (v.occurredAt as number) < 0 ||
      !object(v.project) || !str(v.project.id, 128) || !v.project.id || !str(v.project.name, 500) ||
      !object(v.check)) return false;
  const c = v.check;
  return Array.isArray(c.concepts) && c.concepts.length <= 100 && c.concepts.every(x => str(x, 200)) &&
    str(c.question, 20000) && str(c.answer, 20000) && str(c.feedback, 20000) && str(c.misconception, 2000) &&
    typeof c.outcome === "string" && outcomes.has(c.outcome) &&
    (c.score === null || (typeof c.score === "number" && Number.isFinite(c.score) && c.score >= 0 && c.score <= 1)) &&
    (!["bypass", "explained", "ungraded"].includes(c.outcome) || c.score === null) &&
    str(c.source, 100) && str(c.mode, 100) &&
    (c.filePath === null || (str(c.filePath, 2000) && !c.filePath.startsWith("/") && !/^[A-Za-z]:/.test(c.filePath) && !c.filePath.split(/[\\/]/).includes(".."))) &&
    Number.isSafeInteger(c.retries) && (c.retries as number) >= 0;
}

export function localEndpoint(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) throw new Error("Use http://127.0.0.1:PORT only.");
  return url.origin;
}
