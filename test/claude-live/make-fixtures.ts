/**
 * Turns live run results into path-independent fixtures under
 * test/fixtures/claude-code/<version>/<scenario>.json.
 * Paths are replaced with __PROJECT__ and __GUARD_HOME__; session ids,
 * transcript and scratchpad paths are redacted.
 * usage: npx tsx test/claude-live/make-fixtures.ts <outRoot>
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { SCENARIOS } from "./run-scenario";

const outRoot = path.resolve(process.argv[2] ?? ".");
const fixturesRoot = path.resolve(__dirname, "..", "fixtures", "claude-code");

function sanitize(value: unknown, project: string, home: string): unknown {
  if (typeof value === "string") {
    let s = value;
    for (const [from, to] of [[project, "__PROJECT__"], [home, "__GUARD_HOME__"]] as const) {
      s = s.split(from).join(to).split(from.replace(/\\/g, "/")).join(to);
    }
    return s;
  }
  if (Array.isArray(value)) {
    return value.map((v) => sanitize(v, project, home));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const key = sanitize(k, project, home) as string;
      if (k === "session_id" || k === "prompt_id") {
        out[key] = "00000000-0000-0000-0000-000000000000";
      } else if (k === "transcript_path" || k === "scratchpad_dir") {
        out[key] = "__REDACTED__";
      } else {
        out[key] = sanitize(v, project, home);
      }
    }
    return out;
  }
  return value;
}

for (const name of fs.readdirSync(outRoot)) {
  const file = path.join(outRoot, name, "result.json");
  if (!fs.existsSync(file)) {
    continue;
  }
  const r = JSON.parse(fs.readFileSync(file, "utf8"));
  const version = String(r.claudeVersion).split(" ")[0];
  const fixture = {
    claudeVersion: r.claudeVersion,
    scenario: name,
    prompt: SCENARIOS[name]?.prompt,
    receiver: SCENARIOS[name]?.receiver,
    platform: process.platform,
    note: "Captured from a real `claude -p --model haiku` run. t values are ms since the run started.",
    seed: SCENARIOS[name]?.seed ?? {},
    hookEvents: r.captures.map((c: { t: number; payload: unknown }) => ({
      t: c.t - r.started,
      payload: sanitize(c.payload, r.project, r.home),
    })),
    delivered: [
      ...r.received.map((x: { t: number; envelope: unknown }) => ({ via: "http", t: x.t - r.started, envelope: sanitize(x.envelope, r.project, r.home) })),
      ...r.inbox.map((x: { name: string; body: unknown }) => ({
        via: "inbox",
        t: Number(x.name.split("-")[0]) - r.started,
        envelope: sanitize(x.body, r.project, r.home),
      })),
    ],
    finalFiles: sanitize(r.files, r.project, r.home),
  };
  const dir = path.join(fixturesRoot, version);
  fs.mkdirSync(dir, { recursive: true });
  // receivedAt is an absolute clock value; keep it relative to the run start.
  for (const d of fixture.delivered as { envelope: { receivedAt?: number } }[]) {
    if (typeof d.envelope.receivedAt === "number") {
      d.envelope.receivedAt -= r.started;
    }
  }
  const text = JSON.stringify(fixture, null, 2) + "\n";
  if (text.includes("Samee") || text.includes(r.project)) {
    throw new Error("unsanitized path left in " + name);
  }
  fs.writeFileSync(path.join(dir, name + ".json"), text);
  console.log("wrote", path.join(dir, name + ".json"));
}
