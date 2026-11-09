#!/usr/bin/env node
"use strict";

/**
 * Stand-in for the extension's localhost transport (src/agentGuard.ts
 * startTransport). Writes <home>/.comprehension-guard/endpoint.json with the
 * same shape, checks the token like the extension does, and appends every
 * POSTed envelope to <home>/received.jsonl.
 *
 * usage: node receiver.js <home> [normal|blackhole|slow:<ms>]
 * Prints "READY <port>" on stdout once listening. Stops on SIGTERM / stdin end.
 */

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const home = path.resolve(process.argv[2] || ".");
const mode = process.argv[3] || "normal";
const dir = path.join(home, ".comprehension-guard");
const token = crypto.randomBytes(16).toString("hex");
const out = path.join(home, "received.jsonl");

const server = http.createServer((req, res) => {
  const started = Date.now();
  if (req.method !== "POST" || (req.url || "").split("?")[0] !== "/event") {
    res.writeHead(404);
    res.end();
    return;
  }
  if (req.headers["x-guard-token"] !== token) {
    res.writeHead(401);
    res.end();
    return;
  }
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = undefined;
    }
    fs.appendFileSync(out, JSON.stringify({ t: started, bytes: body.length, envelope: parsed }) + "\n");
    if (mode === "blackhole") {
      return; // never answer
    }
    const wait = mode.startsWith("slow:") ? Number(mode.slice(5)) : 0;
    setTimeout(() => {
      res.writeHead(204);
      res.end();
    }, wait);
  });
});

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "endpoint.json"), JSON.stringify({ port, token, pid: process.pid }) + "\n");
  process.stdout.write("READY " + port + "\n");
});

function stop() {
  try {
    fs.unlinkSync(path.join(dir, "endpoint.json"));
  } catch {
    // gone
  }
  server.close();
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.stdin.on("end", stop);
process.stdin.resume();
