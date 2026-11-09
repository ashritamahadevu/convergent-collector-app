import "../installVscodeStub";
import { after, before } from "node:test";
import * as vscodeStub from "../vscodeStub";
import { OLLAMA, SNIPPET, fakeContext, redirectFetch, startMockServer, type MockServer } from "../harness";
import { generateQuestion, judge, setLogSink } from "../../../src/llm";
import type { GeneratedQuestion } from "../../../src/types";

/**
 * Slow, real-time scenarios (they wait for the real 60s fetch timeout and
 * Node's own socket timeouts). Each lives in its own file so node:test runs
 * them in parallel processes. Enabled only with CG_SLOW=1.
 */
export const SLOW = process.env.CG_SLOW === "1" || process.env.npm_lifecycle_event === "test:network:slow";
export const skip = SLOW ? false : "set CG_SLOW=1 to run (takes minutes)";

export const logs: string[] = [];
export const shared: { server: MockServer; ctx: ReturnType<typeof fakeContext> } = {
  server: undefined as unknown as MockServer,
  ctx: fakeContext(),
};

export function setupOllama(): void {
  let restore = () => {};
  before(async () => {
    shared.server = await startMockServer();
    vscodeStub.settings.set("comprehensionGuard.provider", "ollama");
    restore = redirectFetch([{ from: OLLAMA, to: shared.server.base }]);
    setLogSink((l) => logs.push(l));
  });
  after(async () => {
    restore();
    shared.server.releaseHung({ kind: "json", body: {} });
    await shared.server.close();
  });
}

export async function timed<T>(fn: () => Promise<T>) {
  const start = Date.now();
  try {
    const value = await fn();
    return { ms: Date.now() - start, value, error: undefined as Error | undefined };
  } catch (err) {
    return { ms: Date.now() - start, value: undefined as T | undefined, error: err as Error };
  }
}

export const gen = () =>
  generateQuestion({ context: shared.ctx as never, snippet: SNIPPET, language: "javascript", mode: "free-text" });

export const runJudge = (question: GeneratedQuestion) =>
  judge({ context: shared.ctx as never, snippet: SNIPPET, language: "javascript", question, studentAnswer: "It returns 6." });
