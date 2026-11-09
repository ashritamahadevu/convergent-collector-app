#!/usr/bin/env node
"use strict";

/**
 * Test-only hook. Claude Code runs this next to hook/notify.js so we can see
 * the exact JSON it sends on stdin. It appends one line per event to
 * $CG_CAPTURE_LOG (or <COMPREHENSION_GUARD_HOME>/capture.jsonl), prints
 * nothing, and exits 0, so it never changes what Claude does.
 */

const fs = require("fs");
const path = require("path");

const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const raw = Buffer.concat(chunks).toString("utf8");
  const home = process.env.COMPREHENSION_GUARD_HOME || process.cwd();
  const log = process.env.CG_CAPTURE_LOG || path.join(home, "capture.jsonl");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  const line = JSON.stringify({
    t: Date.now(),
    pid: process.pid,
    argv: process.argv.slice(2),
    envHome: process.env.COMPREHENSION_GUARD_HOME || null,
    shellCwd: process.cwd(),
    payload: parsed,
    raw: parsed === undefined ? raw : undefined,
  });
  try {
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.appendFileSync(log, line + "\n");
  } catch {
    // Never fail the agent.
  }
  process.exit(0);
});
