// Launches the locally installed VS Code with a throwaway profile, a throwaway
// extensions dir, a temp workspace and a temp COMPREHENSION_GUARD_HOME, then
// runs test/network/e2e/suite/index.js inside the extension host.
//
//   node test/network/e2e/run.mjs
//
// Override the VS Code binary with VSCODE_EXE. Nothing is downloaded.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const exe =
  process.env.VSCODE_EXE ??
  path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "Code.exe");
if (!existsSync(exe)) {
  console.error("VS Code not found at " + exe + " (set VSCODE_EXE).");
  process.exit(2);
}

execFileSync(process.execPath, ["esbuild.js"], { cwd: root, stdio: "inherit" });

const tmp = mkdtempSync(path.join(tmpdir(), "cg-e2e-"));
const userData = path.join(tmp, "user-data");
const extDir = path.join(tmp, "extensions");
const ws = path.join(tmp, "workspace");
const home = path.join(tmp, "guard-home");
for (const d of [path.join(userData, "User"), extDir, path.join(ws, ".vscode"), home]) {
  mkdirSync(d, { recursive: true });
}
writeFileSync(
  path.join(userData, "User", "settings.json"),
  JSON.stringify(
    {
      "security.workspace.trust.enabled": false,
      "workbench.startupEditor": "none",
      "update.mode": "none",
      "extensions.autoUpdate": false,
      "extensions.autoCheckUpdates": false,
      "telemetry.telemetryLevel": "off",
      "files.autoSave": "off",
      "comprehensionGuard.provider": "ollama",
    },
    null,
    2,
  ),
);
writeFileSync(path.join(ws, ".vscode", "settings.json"), JSON.stringify({ "comprehensionGuard.provider": "ollama" }));
for (const name of ["a.js", "b.js", "c.js", "d.js", "e.js"]) {
  writeFileSync(path.join(ws, name), "// " + name + "\nconst seed = 1;\n");
}
const resultsFile = path.join(tmp, "results.json");

let failed = false;
try {
  await runTests({
    vscodeExecutablePath: exe,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, "test", "network", "e2e", "suite", "index.js"),
    launchArgs: [
      ws,
      "--user-data-dir",
      userData,
      "--extensions-dir",
      extDir,
      "--disable-extensions",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--new-window",
    ],
    extensionTestsEnv: { COMPREHENSION_GUARD_HOME: home, E2E_RESULTS: resultsFile },
  });
} catch (err) {
  failed = true;
  console.error("VS Code test run failed:", err);
}

if (existsSync(resultsFile)) {
  const results = JSON.parse(readFileSync(resultsFile, "utf8"));
  for (const r of results) {
    const mark = r.ok === undefined ? "    " : r.ok ? "PASS" : "FAIL";
    console.log(
      mark + "  [" + r.scenario + "] " + r.check + "  expected=" + JSON.stringify(r.expected) + " actual=" + JSON.stringify(r.actual) + (r.note ? "  (" + r.note + ")" : ""),
    );
  }
  console.log("\nresults: " + resultsFile);
} else {
  console.error("no results written");
  failed = true;
}
process.exit(failed ? 1 : 0);
