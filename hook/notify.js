#!/usr/bin/env node
"use strict";

/**
 * Notifier installed by "Comprehension Guard: Install AI Agent Hooks".
 *
 * Claude Code, Codex, and Cursor run this after an agent edits a file.
 * It reads the hook JSON on stdin and posts it to the editor extension.
 * If the editor is not running, the event is left in an inbox folder.
 * PreToolUse copies the file aside first so a failed quiz can restore it.
 *
 * The script always exits 0 and prints nothing, so the agent is not blocked
 * and hook parsers do not treat the output as a decision.
 */

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const MAX_SNAPSHOT_BYTES = 1_500_000;
const MAX_BODY_BYTES = 1_500_000;

function guardHome() {
  const override = process.env.COMPREHENSION_GUARD_HOME;
  if (override && override.trim()) {
    return path.resolve(override.trim());
  }
  return os.homedir();
}

function guardDir() {
  return path.join(guardHome(), ".comprehension-guard");
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function asObject(value) {
  if (typeof value === "string") {
    try {
      return asObject(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value;
}

function pushPath(paths, filePath, cwd) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    return;
  }
  const trimmed = filePath.trim();
  const abs = path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(cwd || process.cwd(), trimmed);
  paths.add(abs);
}

function collectPaths(payload) {
  const paths = new Set();
  const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
  pushPath(paths, payload.file_path, cwd);
  pushPath(paths, payload.filePath, cwd);
  pushPath(paths, payload.notebook_path, cwd);
  pushPath(paths, payload.path, cwd);
  const input = asObject(payload.tool_input) || asObject(payload.toolInput);
  if (input) {
    pushPath(paths, input.file_path, cwd);
    pushPath(paths, input.filePath, cwd);
    pushPath(paths, input.notebook_path, cwd);
    pushPath(paths, input.target_notebook, cwd);
    pushPath(paths, input.path, cwd);
    if (typeof input.command === "string") {
      const re = /\*\*\* (?:Update|Add|Delete) File: ([^\n\r]+)/g;
      let match;
      while ((match = re.exec(input.command))) {
        pushPath(paths, match[1], cwd);
      }
    }
    if (Array.isArray(input.edits)) {
      for (const edit of input.edits) {
        if (edit && typeof edit === "object") {
          pushPath(paths, edit.file_path || edit.filePath, cwd);
        }
      }
    }
  }
  if (Array.isArray(payload.edits)) {
    for (const edit of payload.edits) {
      if (edit && typeof edit === "object") {
        pushPath(paths, edit.file_path || edit.filePath, cwd);
      }
    }
  }
  return [...paths];
}

function snapshotId(absPath) {
  return crypto.createHash("sha1").update(path.resolve(absPath)).digest("hex");
}

function saveSnapshots(filePaths) {
  const snapDir = path.join(guardDir(), "snapshots");
  fs.mkdirSync(snapDir, { recursive: true });
  for (const absPath of filePaths) {
    try {
      const stat = fs.statSync(absPath);
      if (!stat.isFile() || stat.size > MAX_SNAPSHOT_BYTES) {
        continue;
      }
      const bytes = fs.readFileSync(absPath);
      if (bytes.includes(0)) {
        continue;
      }
      fs.writeFileSync(path.join(snapDir, snapshotId(absPath) + ".txt"), bytes);
    } catch {
      // A new file has nothing to snapshot.
    }
  }
}

function loadSnapshots(filePaths) {
  const snapDir = path.join(guardDir(), "snapshots");
  const snapshots = {};
  for (const absPath of filePaths) {
    try {
      snapshots[path.resolve(absPath)] = fs.readFileSync(
        path.join(snapDir, snapshotId(absPath) + ".txt"),
        "utf8",
      );
    } catch {
      // No pre-edit copy.
    }
  }
  return snapshots;
}

function shrinkPayload(payload) {
  const copy = JSON.parse(JSON.stringify(payload));
  for (const key of ["tool_input", "toolInput"]) {
    if (typeof copy[key] === "string") {
      const parsed = asObject(copy[key]);
      if (parsed && typeof parsed.content === "string" && parsed.content.length > 200_000) {
        parsed.content = "";
        parsed.contentOmitted = true;
        copy[key] = parsed;
      }
      continue;
    }
    if (copy[key] && typeof copy[key].content === "string" && copy[key].content.length > 200_000) {
      copy[key].content = "";
      copy[key].contentOmitted = true;
    }
  }
  return copy;
}

function postJson(body) {
  let endpoint;
  try {
    endpoint = JSON.parse(fs.readFileSync(path.join(guardDir(), "endpoint.json"), "utf8"));
  } catch {
    return Promise.resolve(false);
  }
  if (!endpoint || typeof endpoint.port !== "number" || typeof endpoint.token !== "string") {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: endpoint.port,
        path: "/event",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "X-Guard-Token": endpoint.token,
        },
        timeout: 1500,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end(body);
  });
}

function writeInbox(body) {
  const inbox = path.join(guardDir(), "inbox");
  fs.mkdirSync(inbox, { recursive: true });
  const name = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.json`;
  fs.writeFileSync(path.join(inbox, name), body);
}

function eventName(payload) {
  return payload.hook_event_name || payload.hookEventName || payload.event || "";
}

async function main() {
  if (process.stdin.isTTY) {
    return;
  }
  const raw = await readStdin();
  if (!raw.trim()) {
    return;
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return;
  }
  const filePaths = collectPaths(payload);
  const event = eventName(payload);
  if (process.argv.includes("--snapshot") || event === "PreToolUse" || event === "BeforeTool") {
    saveSnapshots(filePaths);
    return;
  }
  const snapshots = loadSnapshots(filePaths);
  let envelope = {
    receivedAt: Date.now(),
    snapshots,
    payload: shrinkPayload(payload),
  };
  let body = JSON.stringify(envelope);
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
    envelope = {
      receivedAt: envelope.receivedAt,
      snapshots: {},
      snapshotDir: path.join(guardDir(), "snapshots"),
      payload: envelope.payload,
    };
    body = JSON.stringify(envelope);
  }
  const delivered = await postJson(body);
  if (!delivered) {
    writeInbox(body);
  }
}

main()
  .catch(() => {})
  .then(() => process.exit(0));
