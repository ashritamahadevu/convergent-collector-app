import { shared, setupOllama, skip, timed, gen } from "./common";
import { FREE_TEXT_QUESTION, ollamaReply, type Behaviour } from "../harness";
import assert from "node:assert/strict";
import { test } from "node:test";

setupOllama();

test("response at 55s (just under the 60s timeout) succeeds on the first attempt", { skip, timeout: 400_000 }, async () => {
  shared.server.handler = () => ({ ...ollamaReply(FREE_TEXT_QUESTION), delayMs: 55_000 }) as Behaviour;
  const r = await timed(gen);
  console.log("[observed] 55s response -> " + r.ms + "ms, error=" + r.error?.message);
  assert.ifError(r.error);
  assert.equal(shared.server.requests.length, 1);
});

test("response at 65s (just over) is aborted and retried; every retry is also slow -> timed out", { skip, timeout: 400_000 }, async () => {
  shared.server.requests.length = 0;
  shared.server.handler = () => ({ ...ollamaReply(FREE_TEXT_QUESTION), delayMs: 65_000 }) as Behaviour;
  const r = await timed(gen);
  console.log("[observed] 65s response -> " + r.ms + "ms, " + shared.server.requests.length + " requests, error=" + r.error?.message);
  assert.equal(r.error?.message, "Question generation timed out.");
  assert.equal(shared.server.requests.length, 3);
});
