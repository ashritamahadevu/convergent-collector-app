#!/usr/bin/env node
/**
 * Installs the VSIX with the Cursor app, not the agent CLI.
 *
 * `cursor` on PATH is often ~/.local/bin/cursor, a shim that only runs
 * `cursor agent`. That shim errors on --install-extension even when the
 * Cursor app is installed.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyCursorBinary, ideCandidatePaths } from "./cursor-ide.mjs";

const vsix = path.resolve("comprehension-guard-0.0.1.vsix");
if (!fs.existsSync(vsix)) {
  console.error("Missing " + vsix + ". Run npm run package first.");
  process.exit(1);
}

function readHead(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(8000);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }
}

const candidates = ideCandidatePaths(process.platform, os.homedir(), process.env);
const commandName = process.platform === "win32" ? "cursor.cmd" : "cursor";
for (const dir of (process.env.PATH || "").split(path.delimiter)) {
  if (dir) {
    candidates.push(path.join(dir, commandName));
  }
}

const seen = new Set();
let chosen = "";
for (const candidate of candidates) {
  if (seen.has(candidate)) {
    continue;
  }
  seen.add(candidate);
  if (!fs.existsSync(candidate)) {
    continue;
  }
  if (classifyCursorBinary(candidate, readHead(candidate)) === "ide") {
    chosen = candidate;
    break;
  }
}

if (!chosen) {
  console.error(
    [
      "The cursor command on your PATH is the agent CLI. It cannot install extensions.",
      "Open the Cursor app, then Extensions → ... → Install from VSIX..., and choose:",
      "  " + vsix,
    ].join("\n"),
  );
  process.exit(1);
}

console.log("Installing with " + chosen);
const result = spawnSync(chosen, ["--install-extension", vsix], {
  stdio: "inherit",
});
process.exit(result.status === null ? 1 : result.status);
