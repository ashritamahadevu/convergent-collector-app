/**
 * Feeds what the live runs delivered (received.jsonl / inbox) back through
 * editsFromHookEnvelope and prints a compact summary per scenario.
 * usage: npx tsx test/claude-live/analyze.ts <outRoot> [scenario...]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { editsFromHookEnvelope, snapshotFileName, quizSnippet } from "../../src/agentProtocol";

const root = path.resolve(process.argv[2] ?? ".");
const only = process.argv.slice(3);

for (const name of fs.readdirSync(root)) {
  if (only.length && !only.includes(name)) {
    continue;
  }
  const file = path.join(root, name, "result.json");
  if (!fs.existsSync(file)) {
    continue;
  }
  const r = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log("\n=== " + name + " (" + r.claudeVersion + ", " + r.durationMs + "ms)");
  const posts = r.captures.filter((c: any) => c.payload?.hook_event_name === "PostToolUse");
  for (const c of r.captures) {
    const p = c.payload ?? {};
    const ti = p.tool_input ?? {};
    console.log(
      "  capture", c.t - r.started, p.hook_event_name, p.tool_name,
      JSON.stringify({ file_path: ti.file_path, notebook_path: ti.notebook_path, command: ti.command?.slice?.(0, 80), edit_mode: ti.edit_mode, cell_id: ti.cell_id }),
      "resp:", p.tool_response && typeof p.tool_response === "object" ? Object.keys(p.tool_response).join(",") : typeof p.tool_response,
    );
  }
  const envelopes = [
    ...r.received.map((x: any) => ({ via: "http", t: x.t, env: x.envelope })),
    ...r.inbox.map((x: any) => ({ via: "inbox:" + x.name, t: Number(x.name.split("-")[0]), env: x.body })),
  ];
  for (const e of envelopes) {
    const edits = editsFromHookEnvelope(e.env, {
      readFile: (abs) => {
        try {
          return fs.readFileSync(abs, "utf8");
        } catch {
          return undefined;
        }
      },
      readSnapshot: (abs) => {
        try {
          return fs.readFileSync(path.join(r.home, ".comprehension-guard", "snapshots", snapshotFileName(abs)), "utf8");
        } catch {
          return undefined;
        }
      },
    });
    console.log("  delivered", e.via, "+" + (e.t - r.started) + "ms", "tool=" + e.env.payload?.tool_name, "snapshots=" + Object.keys(e.env.snapshots ?? {}).length);
    for (const ed of edits) {
      console.log(
        "    edit", ed.agent, ed.filePath, "snippetLen=" + quizSnippet(ed.snippet).length,
        "hunks=" + ed.hunks.length, "restore=" + !!ed.restore, "created=" + ed.created, "next=" + (ed.next !== undefined),
      );
    }
    if (edits.length === 0) {
      console.log("    (no edits parsed)");
    }
  }
  console.log("  posts=" + posts.length + " delivered=" + envelopes.length);
}
