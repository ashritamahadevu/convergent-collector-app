#!/usr/bin/env node
"use strict";

/**
 * Launches the user's installed VS Code (no download) with a throwaway
 * --user-data-dir / --extensions-dir and a temp workspace, loads this
 * extension from the worktree, and runs test/e2e/suite.js in three phases
 * that share globalState (main, resume-snoozed, resume-expired).
 *
 * usage: node test/e2e/run.js [--keep] [--only scenarioA,scenarioB] [--phases main,resume-snoozed]
 * env:   CG_VSCODE=<path to Code.exe>   (default: the per-user install)
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { runTests } = require("@vscode/test-electron");

const REPO = path.resolve(__dirname, "..", "..");
const args = process.argv.slice(2);
const keep = args.includes("--keep");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "";
const phases = args.includes("--phases")
  ? args[args.indexOf("--phases") + 1].split(",")
  : ["main", "resume-snoozed", "resume-expired"];

const exe =
  process.env.CG_VSCODE ||
  path.join(process.env.LOCALAPPDATA || "", "Programs", "Microsoft VS Code", "Code.exe");

function readGlobalState(udd) {
  const db = path.join(udd, "User", "globalStorage", "state.vscdb");
  if (!fs.existsSync(db)) {
    return undefined;
  }
  try {
    const { DatabaseSync } = require("node:sqlite");
    const conn = new DatabaseSync(db, { readOnly: true });
    const row = conn.prepare("SELECT value FROM ItemTable WHERE key = ?").get("comprehension-guard.comprehension-guard");
    conn.close();
    return row ? JSON.parse(String(row.value)) : undefined;
  } catch (err) {
    return { error: String(err) };
  }
}

async function main() {
  if (!fs.existsSync(path.join(REPO, "dist", "extension.js"))) {
    throw new Error("build first: node esbuild.js");
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cg-e2e-"));
  const udd = path.join(root, "user-data");
  const extDir = path.join(root, "extensions");
  const ws = path.join(root, "workspace with space");
  const home = path.join(root, "guard-home");
  const out = path.join(root, "results");
  for (const d of [udd, extDir, ws, home, out]) {
    fs.mkdirSync(d, { recursive: true });
  }
  fs.mkdirSync(path.join(udd, "User"), { recursive: true });
  fs.writeFileSync(
    path.join(udd, "User", "settings.json"),
    JSON.stringify(
      {
        "comprehensionGuard.provider": "ollama",
        "comprehensionGuard.model": "mock",
        "comprehensionGuard.mode": "auto",
        "security.workspace.trust.enabled": false,
        "workbench.startupEditor": "none",
        "update.mode": "none",
        "extensions.autoUpdate": false,
        "extensions.autoCheckUpdates": false,
        "telemetry.telemetryLevel": "off",
        "window.restoreWindows": "none",
        "files.autoSave": "off",
        "git.enabled": false,
      },
      null,
      2,
    ),
  );
  console.log("e2e root:", root);
  const summary = { root, exe, phases: {}, globalState: {} };
  for (const phase of phases) {
    console.log("\n--- phase " + phase);
    try {
      await runTests({
        vscodeExecutablePath: exe,
        extensionDevelopmentPath: REPO,
        extensionTestsPath: path.join(__dirname, "suite.js"),
        launchArgs: [
          ws,
          "--user-data-dir",
          udd,
          "--extensions-dir",
          extDir,
          "--disable-workspace-trust",
          "--skip-welcome",
          "--skip-release-notes",
          "--disable-telemetry",
          "--new-window",
        ],
        extensionTestsEnv: {
          COMPREHENSION_GUARD_HOME: home,
          CG_E2E_PHASE: phase,
          CG_E2E_OUT: out,
          CG_E2E_WS: ws,
          CG_E2E_ONLY: only,
          CG_NODE: process.execPath,
        },
      });
    } catch (err) {
      console.error("phase " + phase + " failed:", err);
    }
    const file = path.join(out, phase + ".json");
    if (fs.existsSync(file)) {
      const r = JSON.parse(fs.readFileSync(file, "utf8"));
      summary.phases[phase] = r.results;
      summary.vscodeVersion = r.vscodeVersion;
      for (const res of r.results) {
        console.log(`${res.verdict.padEnd(16)} ${res.id.padEnd(4)} ${res.scenario}\n${" ".repeat(22)}${JSON.stringify(res.observed)}`);
      }
    }
    const gs = readGlobalState(udd);
    summary.globalState[phase] = gs && { walkthrough: gs["comprehensionGuard.walkthrough"], mastery: gs["comprehensionGuard.conceptMastery"] };
    console.log("walkthrough state after " + phase + ":", JSON.stringify(summary.globalState[phase] && summary.globalState[phase].walkthrough && {
      session: summary.globalState[phase].walkthrough.session,
      snoozeUntil: summary.globalState[phase].walkthrough.snoozeUntil,
      files: summary.globalState[phase].walkthrough.files.map((f) => path.basename(f.path)),
    }));
  }
  const summaryFile = path.join(REPO, "test-reports", "e2e-last-run.json");
  fs.mkdirSync(path.dirname(summaryFile), { recursive: true });
  fs.writeFileSync(summaryFile, JSON.stringify(summary, (k, v) => (typeof v === "string" ? v.split(root).join("<e2e-root>") : v), 2));
  console.log("\nsummary written to", summaryFile);
  if (!keep) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
