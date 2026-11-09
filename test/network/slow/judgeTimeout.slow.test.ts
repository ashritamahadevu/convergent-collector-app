import { shared, setupOllama, skip, timed, runJudge } from "./common";
import { FREE_TEXT_QUESTION } from "../harness";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GeneratedQuestion } from "../../../src/types";

setupOllama();

test("judge never answers: two 60s attempts, then no_decision(timeout) (~121s with no progress UI)", { skip, timeout: 400_000 }, async () => {
  shared.server.handler = () => ({ kind: "hang" });
  const r = await timed(() => runJudge(FREE_TEXT_QUESTION as GeneratedQuestion));
  console.log("[observed] judge hang -> " + r.ms + "ms -> " + JSON.stringify(r.value));
  assert.deepEqual(r.value, { kind: "no_decision", reason: "timeout" });
  assert.ok(r.ms >= 120_000);
});
