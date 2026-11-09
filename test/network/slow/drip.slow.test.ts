import { shared, setupOllama, skip, timed, gen } from "./common";
import { FREE_TEXT_QUESTION } from "../harness";
import assert from "node:assert/strict";
import { test } from "node:test";

setupOllama();

test("BUG: a body that trickles (1 byte / 5s) for 150s is waited on with no limit", { skip, timeout: 400_000 }, async () => {
  shared.server.handler = () => ({
    kind: "drip",
    intervalMs: 5_000,
    totalMs: 150_000,
    body: { message: { content: JSON.stringify(FREE_TEXT_QUESTION) } },
  });
  const r = await timed(gen);
  console.log("[observed] drip 150s -> " + r.ms + "ms, " + shared.server.requests.length + " requests, error=" + r.error?.message);
  assert.ifError(r.error);
  assert.ok(r.ms >= 150_000, "single request lived " + r.ms + "ms, well past the 60s timeout");
  assert.equal(shared.server.requests.length, 1);
});
