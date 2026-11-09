import { shared, setupOllama, skip, timed, gen } from "./common";
import assert from "node:assert/strict";
import { test } from "node:test";

setupOllama();

test("BUG: headers arrive, body never does: the 60s timeout does not cover the body", { skip, timeout: 700_000 }, async () => {
  shared.server.handler = () => ({ kind: "headersThenStall" });
  const r = await timed(gen);
  console.log("[observed] body stall -> " + r.ms + "ms, " + shared.server.requests.length + " requests, error=" + r.error?.message);
  assert.ok(r.ms > 90_000, "outlived FETCH_TIMEOUT_MS (60s)");
});
