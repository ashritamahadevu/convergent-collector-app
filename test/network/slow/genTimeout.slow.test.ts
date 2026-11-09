import { shared, setupOllama, skip, timed, gen } from "./common";
import assert from "node:assert/strict";
import { test } from "node:test";

setupOllama();

test("provider accepts the request and never answers: generation gives up after 3 x 60s + backoff", { skip, timeout: 400_000 }, async () => {
  shared.server.handler = () => ({ kind: "hang" });
  const r = await timed(gen);
  console.log("[observed] generation hang -> " + r.ms + "ms, " + shared.server.requests.length + " requests, error: " + r.error?.message);
  assert.equal(r.error?.message, "Question generation timed out.");
  assert.equal(shared.server.requests.length, 3);
  assert.ok(r.ms >= 180_000);
});
