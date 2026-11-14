#!/usr/bin/env node
"use strict";

/**
 * Pause gate installed by "Comprehension Guard: Install AI Agent Hooks".
 *
 * Claude Code, Codex, Cursor, Gemini CLI, Copilot CLI, Droid, Goose, and
 * Antigravity run this before a mutating tool. It asks
 * the editor whether that tool may proceed. The request stays open until
 * the student passes, fails, or bypasses a check. If the editor is closed,
 * the tool is allowed so the agent is not trapped.
 *
 * The script always exits 0. The only stdout is a permission decision.
 */

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const TIMEOUT_MS = 10 * 60 * 1000;

const MUTATING_TOOLS = new Set([
  "edit",
  "write",
  "multiedit",
  "notebookedit",
  "applypatch",
  "strreplace",
  "delete",
  "bash",
  "shell",
  "powershell",
  "exec",
  "editnotebook",
  "searchreplace",
  "writefile",
  "replace",
  "create",
  "writetofile",
  "replacefilecontent",
  "multireplacefilecontent",
]);

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

function eventName(payload) {
  const name = payload.hook_event_name || payload.hookEventName || payload.event || "";
  return typeof name === "string" ? name : "";
}

function agentFlag() {
  const fromArg = process.argv.find((item) => item.startsWith("--agent="));
  if (fromArg) {
    return fromArg.slice("--agent=".length);
  }
  return process.env.COMPREHENSION_GUARD_AGENT || "";
}

function toolName(payload) {
  const call = asObject(payload.toolCall);
  if (call && typeof call.name === "string" && call.name.trim()) {
    return call.name.trim();
  }
  if (typeof payload.tool_name === "string" && payload.tool_name.trim()) {
    return payload.tool_name.trim();
  }
  if (typeof payload.toolName === "string" && payload.toolName.trim()) {
    return payload.toolName.trim();
  }
  const input = asObject(payload.tool_input) || asObject(payload.toolInput);
  if (input && typeof input.tool === "string" && input.tool.trim()) {
    return input.tool.trim();
  }
  return "";
}

function normalizeTool(name) {
  return name.toLowerCase().replace(/[_\- ]/g, "");
}

function isMutating(name) {
  const normalized = normalizeTool(name);
  return normalized.length > 0 && MUTATING_TOOLS.has(normalized);
}

function isCursorPause(event) {
  return event.toLowerCase() === "pretooluse" && event !== "PreToolUse";
}

function allowDecision(cursor, context) {
  if (cursor) {
    const decision = { permission: "allow" };
    if (context) {
      decision.agent_message = context;
    }
    return decision;
  }
  const output = {
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
  };
  if (context) {
    output.additionalContext = context;
  }
  return { hookSpecificOutput: output };
}

function geminiAllow(context) {
  const decision = { decision: "allow" };
  if (context) {
    decision.hookSpecificOutput = { additionalContext: context };
  }
  return decision;
}

function geminiDeny(agentMessage) {
  return {
    decision: "deny",
    reason: agentMessage || "Comprehension Guard paused this write.",
  };
}

function copilotDecision(allow, context) {
  const decision = { permissionDecision: allow ? "allow" : "deny" };
  if (context) {
    decision.permissionDecisionReason = context;
  }
  return decision;
}

function gooseDecision(allow, context) {
  if (!allow) {
    return { decision: "block", reason: context || "Comprehension Guard paused this write." };
  }
  return context ? { decision: "allow", reason: context } : { decision: "allow" };
}

function antigravityDecision(allow, context) {
  return {
    decision: allow ? "allow" : "deny",
    reason: context || (allow ? "Continue." : "Comprehension Guard paused this write."),
  };
}

function formatDecision(agent, cursor, allow, userMessage, agentMessage) {
  if (agent === "copilot") {
    return copilotDecision(allow, agentMessage);
  }
  if (agent === "goose") {
    return gooseDecision(allow, agentMessage);
  }
  if (agent === "antigravity") {
    return antigravityDecision(allow, agentMessage);
  }
  if (agent === "gemini") {
    return allow ? geminiAllow(agentMessage) : geminiDeny(agentMessage);
  }
  return allow ? allowDecision(cursor, agentMessage) : denyDecision(cursor, userMessage, agentMessage);
}

function denyDecision(cursor, userMessage, agentMessage) {
  if (cursor) {
    return {
      permission: "deny",
      user_message: userMessage,
      agent_message: agentMessage,
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: agentMessage,
    },
  };
}

function postPause(body) {
  let endpoint;
  try {
    endpoint = JSON.parse(fs.readFileSync(path.join(guardDir(), "endpoint.json"), "utf8"));
  } catch {
    return Promise.resolve(undefined);
  }
  if (!endpoint || typeof endpoint.port !== "number" || typeof endpoint.token !== "string") {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    let settled = false;
    let overall;
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(overall);
      resolve(value);
    };
    const req = http.request(
      {
        host: "127.0.0.1",
        port: endpoint.port,
        path: "/pause",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "X-Guard-Token": endpoint.token,
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => finish(Buffer.concat(chunks).toString("utf8")));
        res.on("error", () => finish(undefined));
      },
    );
    overall = setTimeout(() => {
      req.destroy();
      finish(undefined);
    }, TIMEOUT_MS);
    req.on("error", () => finish(undefined));
    req.on("timeout", () => {
      req.destroy();
      finish(undefined);
    });
    req.end(body);
  });
}

function parseDecision(text) {
  if (typeof text !== "string" || !text.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || typeof parsed.allow !== "boolean") {
      return undefined;
    }
    return {
      allow: parsed.allow,
      userMessage: typeof parsed.userMessage === "string" ? parsed.userMessage : "",
      agentMessage: typeof parsed.agentMessage === "string" ? parsed.agentMessage : "",
    };
  } catch {
    return undefined;
  }
}

function writeDecision(decision) {
  const text = JSON.stringify(decision) + "\n";
  return new Promise((resolve) => {
    process.stdout.write(text, () => resolve());
  });
}

async function main() {
  if (process.stdin.isTTY) {
    return undefined;
  }
  const raw = await readStdin();
  if (!raw.trim()) {
    return undefined;
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const event = eventName(payload);
  const eventKey = event.toLowerCase();
  const agent = agentFlag() || (event === "BeforeTool" ? "gemini" : "");
  if (
    eventKey === "afterfileedit" ||
    eventKey === "posttooluse" ||
    eventKey === "aftertool" ||
    eventKey === "stop" ||
    eventKey === "notification"
  ) {
    return undefined;
  }
  const pauseEvent = eventKey === "pretooluse" || event === "BeforeTool" || agent === "antigravity";
  if (!pauseEvent) {
    return undefined;
  }
  const cursor = isCursorPause(event);
  if (!isMutating(toolName(payload))) {
    return formatDecision(agent, cursor, true, "", "");
  }
  const body = JSON.stringify({
    receivedAt: Date.now(),
    kind: "pause",
    payload,
  });
  const responseText = await postPause(body);
  const decision = parseDecision(responseText);
  const allowed = !decision || decision.allow;
  const context = allowed && decision ? decision.agentMessage : decision ? decision.agentMessage : "";
  return formatDecision(
    agent,
    cursor,
    allowed,
    decision ? decision.userMessage : "",
    context,
  );
}

main()
  .catch(() => undefined)
  .then((decision) => (decision ? writeDecision(decision) : undefined))
  .then(() => process.exit(0));
