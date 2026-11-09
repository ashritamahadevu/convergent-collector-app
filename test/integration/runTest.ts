/**
 * Integration harness for interruption scenarios.
 *
 *   npm run test:integration                 # all scenarios
 *   npm run test:integration -- --only a,b   # a subset
 *
 * Launches the locally installed VS Code (no download) once per scenario
 * phase, with a throwaway --user-data-dir, --extensions-dir, workspace and
 * COMPREHENSION_GUARD_HOME under the OS temp folder. The user's real profile
 * and ~/.comprehension-guard are never touched.
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runTests } from "@vscode/test-electron";
import * as esbuild from "esbuild";
import { AGENT_BEFORE, AGENT_NEW_BODY, SCENARIOS, type ScenarioMeta } from "./manifest";
import { claudeWritePayloads, runNotify } from "./hookSim";

const REPO = path.resolve(__dirname, "..", "..");
const SUITE_OUT = path.join(REPO, "test", "integration", "out", "suite.js");
const RESULTS_OUT = path.join(REPO, "test", "integration", "out", "results.json");
const DEFAULT_CODE = "C:\\Users\\Samee\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe";
const CODE = process.env.CG_VSCODE_PATH || DEFAULT_CODE;
const PHASE_TIMEOUT_MS = 150_000;

type Check = { ok: boolean; expectation: string; observed: string };
type PhaseResult = {
  scenario: string;
  phase: number;
  checks: Check[];
  notes: string[];
  error?: string;
  untested?: string;
};

type ScenarioOutcome = {
  id: string;
  path: string;
  title: string;
  verdict: "PASS" | "BUG" | "ERROR" | "UNTESTED";
  phases: PhaseResult[];
  launchErrors: string[];
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 ? new Set(args[onlyIdx + 1].split(",").map((s) => s.trim())) : undefined;
  const keep = args.includes("--keep");

  if (!fs.existsSync(CODE)) {
    throw new Error("VS Code not found at " + CODE + ". Set CG_VSCODE_PATH.");
  }
  const exe = resolveLaunchExecutable(CODE);

  console.log("[harness] building extension (dev build)");
  execFileSync(process.execPath, [path.join(REPO, "esbuild.js")], { cwd: REPO, stdio: "inherit" });
  console.log("[harness] bundling suite");
  await esbuild.build({
    entryPoints: [path.join(REPO, "test", "integration", "suite", "index.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    outfile: SUITE_OUT,
    external: ["vscode"],
    sourcemap: "inline",
    logLevel: "warning",
  });

  const selected = SCENARIOS.filter((s) => !only || only.has(s.id));
  if (selected.length === 0) {
    throw new Error("No scenarios matched.");
  }
  const outcomes: ScenarioOutcome[] = [];
  for (const scenario of selected) {
    outcomes.push(await runScenario(scenario, keep, exe));
    fs.mkdirSync(path.dirname(RESULTS_OUT), { recursive: true });
    fs.writeFileSync(RESULTS_OUT, JSON.stringify(outcomes, null, 2));
  }

  console.log("\n=== Interruption scenarios ===");
  for (const outcome of outcomes) {
    console.log(`${outcome.verdict.padEnd(8)} ${outcome.id}  (${outcome.title})`);
    for (const phase of outcome.phases) {
      for (const check of phase.checks) {
        const mark = check.ok ? "ok  " : "FAIL";
        console.log(`    [p${phase.phase}] ${mark} ${check.expectation} -> ${check.observed}`);
      }
      for (const note of phase.notes) {
        console.log(`    [p${phase.phase}] note ${note}`);
      }
      if (phase.error) {
        console.log(`    [p${phase.phase}] error ${phase.error}`);
      }
      if (phase.untested) {
        console.log(`    [p${phase.phase}] untested ${phase.untested}`);
      }
    }
    for (const err of outcome.launchErrors) {
      console.log(`    launch: ${err}`);
    }
  }
  console.log("\nResults written to " + RESULTS_OUT);
  const bad = outcomes.filter((o) => o.verdict === "BUG" || o.verdict === "ERROR");
  console.log(`${outcomes.length - bad.length}/${outcomes.length} scenarios without a bug or error.`);
  process.exitCode = bad.length > 0 ? 1 : 0;
}

/**
 * A Windows user install with a pending background update ("updating_version"
 * next to Code.exe) refuses to start while the updater holds its mutex:
 * "Code is currently being updated". In that case launch the same installed
 * binaries through a shim folder in temp: Code.exe is hard-linked, the version
 * folder is junctioned, and only a copied product.json differs
 * (win32VersionedUpdate=false, which skips the updater-mutex wait). Nothing is
 * downloaded and the real install is not modified. CG_VSCODE_SHIM=0 disables it.
 */
function resolveLaunchExecutable(codeExe: string): string {
  const installDir = path.dirname(codeExe);
  const updating = fs.existsSync(path.join(installDir, "updating_version"));
  const wanted = process.env.CG_VSCODE_SHIM;
  if (process.platform !== "win32" || wanted === "0" || (!updating && wanted !== "1")) {
    return codeExe;
  }
  const binary = fs.readFileSync(codeExe);
  const versionDir = fs
    .readdirSync(installDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^[0-9a-f]{10}$/.test(d.name))
    .map((d) => d.name)
    .find((name) => binary.indexOf(Buffer.from(name, "utf16le")) >= 0);
  if (!versionDir) {
    console.warn("[harness] update pending but could not find Code.exe's version folder; launching directly");
    return codeExe;
  }
  const shim = path.join(os.tmpdir(), "cg-int-vscode-shim-" + versionDir);
  const shimExe = path.join(shim, path.basename(codeExe));
  const productTarget = path.join(shim, versionDir, "resources", "app", "product.json");
  if (!fs.existsSync(productTarget)) {
    fs.rmSync(shim, { recursive: true, force: true });
    fs.mkdirSync(shim, { recursive: true });
    fs.linkSync(codeExe, shimExe);
    const src = path.join(installDir, versionDir);
    // Hard-link a whole tree. Used for app/out: VS Code derives its app root
    // (and so which product.json it reads) from the real path of out/main.js.
    const linkTree = (from: string, to: string): void => {
      fs.mkdirSync(to, { recursive: true });
      for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const a = path.join(from, entry.name);
        const b = path.join(to, entry.name);
        if (entry.isDirectory()) {
          linkTree(a, b);
        } else {
          fs.linkSync(a, b);
        }
      }
    };
    // Mirror the version folder, descending only along resources/app.
    const mirror = (from: string, to: string, descend: string[]): void => {
      fs.mkdirSync(to, { recursive: true });
      for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const a = path.join(from, entry.name);
        const b = path.join(to, entry.name);
        if (entry.isDirectory() && entry.name === descend[0]) {
          mirror(a, b, descend.slice(1));
        } else if (entry.isDirectory() && descend.length === 0 && entry.name === "out") {
          linkTree(a, b);
        } else if (entry.isDirectory()) {
          fs.symlinkSync(a, b, "junction");
        } else if (descend.length === 0 && entry.name === "product.json") {
          const product = JSON.parse(fs.readFileSync(a, "utf8")) as Record<string, unknown>;
          product.win32VersionedUpdate = false;
          fs.writeFileSync(b, JSON.stringify(product, null, "\t"));
        } else {
          fs.linkSync(a, b);
        }
      }
    };
    mirror(src, path.join(shim, versionDir), ["resources", "app"]);
  }
  console.log("[harness] VS Code update pending; launching installed binaries through shim " + shimExe);
  return shimExe;
}

async function runScenario(scenario: ScenarioMeta, keep: boolean, exe: string): Promise<ScenarioOutcome> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cg-int-" + scenario.id.slice(0, 24) + "-"));
  const userData = path.join(root, "user-data");
  const extensions = path.join(root, "extensions");
  const workspace = path.join(root, "workspace");
  const guardHome = path.join(root, "guard-home");
  for (const dir of [userData, extensions, workspace, guardHome]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  writeUserSettings(userData);
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "README.txt"), "integration workspace\n");

  if (scenario.preLaunch === "inbox-event") {
    const file = path.join(workspace, "src", "inbox.js");
    fs.writeFileSync(file, AGENT_BEFORE);
    const payloads = claudeWritePayloads(file, AGENT_NEW_BODY, workspace);
    await runNotify(REPO, guardHome, payloads.pre);
    fs.writeFileSync(file, AGENT_NEW_BODY);
    await runNotify(REPO, guardHome, payloads.post);
  }

  console.log(`\n[harness] ${scenario.id} -> ${root}`);
  const outcome: ScenarioOutcome = {
    id: scenario.id,
    path: scenario.path,
    title: scenario.title,
    verdict: "PASS",
    phases: [],
    launchErrors: [],
  };

  let phase = 1;
  while (phase <= scenario.phases.length) {
    // In extension-test mode "Reload Window" terminates the extension host
    // gracefully (deactivate and disposables run) and then VS Code exits instead
    // of reloading, so every phase is its own launch with the same profile,
    // workspace and guard home. "crash" kills the extension host with SIGKILL.
    const lastPhaseInLaunch = phase;
    const endsInCrash = scenario.phases[phase - 1] !== "normal";
    try {
      await withWatchdog(
        runTests({
          vscodeExecutablePath: exe,
          extensionDevelopmentPath: REPO,
          extensionTestsPath: SUITE_OUT,
          launchArgs: [
            workspace,
            "--user-data-dir=" + userData,
            "--extensions-dir=" + extensions,
            "--disable-extensions",
            "--skip-welcome",
            "--skip-release-notes",
            "--disable-workspace-trust",
            "--disable-telemetry",
            "--disable-updates",
            "--new-window",
          ],
          extensionTestsEnv: {
            CG_SCENARIO: scenario.id,
            CG_PHASE: String(phase),
            CG_ROOT: root,
            CG_WORKSPACE: workspace,
            CG_REPO: REPO,
            COMPREHENSION_GUARD_HOME: guardHome,
          },
        }),
        PHASE_TIMEOUT_MS,
        userData,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!endsInCrash) {
        outcome.launchErrors.push(`phase ${phase}: ${message}`);
      }
    }
    if (endsInCrash) {
      // Make sure nothing from the killed instance is still alive.
      killByCommandLine(userData);
    }
    phase = lastPhaseInLaunch + 1;
  }

  for (let p = 1; p <= scenario.phases.length; p++) {
    const file = path.join(root, `result-${p}.json`);
    if (fs.existsSync(file)) {
      outcome.phases.push(JSON.parse(fs.readFileSync(file, "utf8")) as PhaseResult);
    } else {
      outcome.launchErrors.push(`phase ${p}: no result file`);
    }
  }

  const checks = outcome.phases.flatMap((p) => p.checks);
  if (outcome.phases.some((p) => p.untested)) {
    outcome.verdict = "UNTESTED";
  } else if (outcome.launchErrors.length > 0 || outcome.phases.some((p) => p.error)) {
    outcome.verdict = checks.some((c) => !c.ok) ? "BUG" : "ERROR";
  } else if (checks.some((c) => !c.ok)) {
    outcome.verdict = "BUG";
  }

  if (!keep) {
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    } catch {
      // A file can stay locked for a moment after VS Code exits; it is in temp.
    }
  }
  return outcome;
}

function writeUserSettings(userData: string): void {
  const dir = path.join(userData, "User");
  fs.mkdirSync(dir, { recursive: true });
  const settings = {
    "comprehensionGuard.enabled": true,
    "comprehensionGuard.charThreshold": 200,
    "comprehensionGuard.provider": "openai",
    "comprehensionGuard.mode": "learn",
    "workbench.startupEditor": "none",
    "workbench.enableExperiments": false,
    "workbench.tips.enabled": false,
    "telemetry.telemetryLevel": "off",
    "update.mode": "none",
    "extensions.autoUpdate": false,
    "extensions.autoCheckUpdates": false,
    "git.enabled": false,
    "security.workspace.trust.enabled": false,
    "files.autoSave": "off",
    "files.hotExit": "onExitAndWindowClose",
    "window.restoreWindows": "all",
    "window.confirmBeforeClose": "never",
    "editor.formatOnPaste": false,
    "editor.formatOnSave": false,
    "chat.disableAIFeatures": true,
    "github.copilot.enable": { "*": false },
  };
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify(settings, null, 2));
}

async function withWatchdog<T>(work: Promise<T>, ms: number, marker: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      killByCommandLine(marker);
      reject(new Error("timed out after " + ms + "ms; killed the test instance"));
    }, ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/** Kills only processes whose command line contains our temp user-data-dir. */
function killByCommandLine(marker: string): void {
  if (process.platform !== "win32") {
    try {
      execFileSync("pkill", ["-f", marker]);
    } catch {
      // Nothing to kill.
    }
    return;
  }
  const escaped = marker.replace(/'/g, "''");
  const script =
    "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('" +
    escaped +
    "') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore" });
  } catch {
    // Best effort.
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
