// Launches the user's installed VS Code (no download) with a throwaway
// user-data-dir, extensions-dir, workspace and COMPREHENSION_GUARD_HOME, loads
// Comprehension Guard plus a test helper extension, and runs the interference
// suite once per profile. Third-party extensions are installed only into the
// throwaway extensions dir for that profile.
//
// Usage: node test/interference/runInterference.js [plain] [formatters] [vim]
//          [--patched | --patched-only] [--use-copy]
//   --patched       also run against a temp build with the probe fix (see buildPatched)
//   --use-copy      copy the installed VS Code build into the temp dir and run that
//                   copy (needed while a pending background update holds the
//                   "vscode-updating" mutex; the installed copy refuses to start then)
// Env:   CG_VSCODE_EXE   path to Code.exe (default: the per-user install)
//        CG_TMP_ROOT     where throwaway dirs live (default: %TEMP%/cg-interference)
//        CG_ONLY         comma-separated test ids to run
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runTests, resolveCliArgsFromVSCodeExecutablePath } = require("@vscode/test-electron");

const ROOT = path.resolve(__dirname, "..", "..");
const INSTALLED = path.join(os.homedir(), "AppData", "Local", "Programs", "Microsoft VS Code", "Code.exe");
const TMP = process.env.CG_TMP_ROOT || path.join(os.tmpdir(), "cg-interference");
const EXE = process.env.CG_VSCODE_EXE || (process.argv.includes("--use-copy") ? copyInstall() : INSTALLED);

/**
 * Copies the installed VS Code (no download) to TMP/vscode-copy and turns off
 * the Windows update-mutex check in the copy's product.json only. The user's
 * install and its pending update are not touched.
 */
function copyInstall() {
  const srcRoot = path.dirname(INSTALLED);
  const dst = path.join(TMP, "vscode-copy");
  const cmd = fs.readFileSync(path.join(srcRoot, "bin", "code.cmd"), "utf8");
  const commitDir = (cmd.match(/\.\.\\([0-9a-f]{10})\\resources/) || [])[1];
  if (!commitDir) throw new Error("could not find the versioned folder in bin/code.cmd");
  const product = path.join(dst, commitDir, "resources", "app", "product.json");
  if (!fs.existsSync(product)) {
    console.log(`[runner] copying installed VS Code (${commitDir}) to ${dst}`);
    fs.mkdirSync(dst, { recursive: true });
    fs.copyFileSync(INSTALLED, path.join(dst, "Code.exe"));
    fs.cpSync(path.join(srcRoot, commitDir), path.join(dst, commitDir), { recursive: true });
    fs.cpSync(path.join(srcRoot, "bin"), path.join(dst, "bin"), { recursive: true });
  }
  const j = JSON.parse(fs.readFileSync(product, "utf8"));
  if (j.win32VersionedUpdate !== false) {
    j.win32VersionedUpdate = false;
    j.win32MutexName = "vscodecgtest";
    delete j.updateUrl;
    fs.writeFileSync(product, JSON.stringify(j, null, "\t"));
  }
  return path.join(dst, "Code.exe");
}
const RESULTS_DIR = path.join(ROOT, "test-reports", "interference-results");

const PROFILES = {
  plain: { extensions: [] },
  formatters: {
    extensions: [
      "esbenp.prettier-vscode",
      "dbaeumer.vscode-eslint",
      "editorconfig.editorconfig",
      "eamodio.gitlens",
    ],
  },
  vim: { extensions: ["vscodevim.vim"] },
};

function baseSettings(title) {
  return {
    "update.mode": "none",
    "extensions.autoUpdate": false,
    "extensions.autoCheckUpdates": false,
    "extensions.ignoreRecommendations": true,
    "telemetry.telemetryLevel": "off",
    "workbench.startupEditor": "none",
    "workbench.tips.enabled": false,
    "workbench.enableExperiments": false,
    "security.workspace.trust.enabled": false,
    "window.title": title,
    "window.restoreWindows": "none",
    "files.hotExit": "off",
    "chat.commandCenter.enabled": false,
    "git.openRepositoryInParentFolders": "never",
    "gitlens.showWelcomeOnInstall": false,
    "gitlens.showWhatsNewAfterUpgrades": false,
    "gitlens.plusFeatures.enabled": false,
    "prettier.requireConfig": false,
    "editor.inlineSuggest.enabled": true,
    "comprehensionGuard.provider": "openai",
  };
}

function cli() {
  const [cliPath, ...args] = resolveCliArgsFromVSCodeExecutablePath(EXE);
  return { cliPath, args };
}

function runCli(extraArgs) {
  const { cliPath, args } = cli();
  const r = spawnSync(cliPath, [...args, ...extraArgs], { encoding: "utf8", shell: true, timeout: 300000 });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

function ensureExtensions(profile, extDir, userDir) {
  const wanted = PROFILES[profile].extensions;
  if (wanted.length === 0) {
    fs.mkdirSync(extDir, { recursive: true });
    return [];
  }
  const listed = runCli(["--extensions-dir", quote(extDir), "--user-data-dir", quote(userDir), "--list-extensions", "--show-versions"]);
  const have = new Set(
    listed.out
      .split(/\r?\n/)
      .map((l) => l.trim().split("@")[0].toLowerCase())
      .filter(Boolean),
  );
  for (const id of wanted) {
    if (have.has(id.toLowerCase())) continue;
    console.log(`[runner] installing ${id} into throwaway ${extDir}`);
    const r = runCli(["--extensions-dir", quote(extDir), "--user-data-dir", quote(userDir), "--install-extension", id]);
    console.log(r.out.trim());
  }
  const final = runCli(["--extensions-dir", quote(extDir), "--user-data-dir", quote(userDir), "--list-extensions", "--show-versions"]);
  return final.out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[\w.-]+@[\w.-]+$/.test(l));
}

function quote(p) {
  return `"${p}"`;
}

function makeWorkspace(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], {
    cwd: dir,
  });
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { target: "ES2022", module: "commonjs", strict: false } }, null, 2) + "\n",
  );
}

// Builds a copy of the extension into the temp dir with one probe fix applied
// in memory (src/ is not touched): the post-fail delete in pasteGuard.ts and
// editGuard.ts uses a WorkspaceEdit instead of the TextEditor handle, which is
// disposed once the quiz webview covers the editor. This lets the suite see
// interference bugs that the baseline bug would otherwise mask.
async function buildPatched() {
  const esbuild = require("esbuild");
  const out = path.join(TMP, "patched-ext");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "dist"), { recursive: true });
  fs.cpSync(path.join(ROOT, "hook"), path.join(out, "hook"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "package.json"), path.join(out, "package.json"));
  let replaced = 0;
  await esbuild.build({
    entryPoints: [path.join(ROOT, "src", "extension.ts")],
    bundle: true,
    format: "cjs",
    platform: "node",
    outfile: path.join(out, "dist", "extension.js"),
    external: ["vscode"],
    logLevel: "silent",
    plugins: [
      {
        name: "probe-fix",
        setup(build) {
          build.onLoad({ filter: /[\\/](pasteGuard|editGuard)\.ts$/ }, (args) => {
            let src = fs.readFileSync(args.path, "utf8");
            src = src.replace(
              /await editor\.edit\(\(builder\) => \{\s*builder\.delete\(placed\);\s*\}\);/g,
              () => {
                replaced++;
                return "await (async () => { const we = new vscode.WorkspaceEdit(); we.delete(editor.document.uri, placed); await vscode.workspace.applyEdit(we); })();";
              },
            );
            return { contents: src, loader: "ts" };
          });
        },
      },
    ],
  });
  console.log(`[runner] patched build at ${out} (${replaced} delete sites rewritten)`);
  return out;
}

async function runProfile(profile, extRoot, append) {
  const stamp = Date.now().toString(36);
  const extDir = path.join(TMP, "ext-" + profile); // cached between runs
  const installUserDir = path.join(TMP, "install-user-" + profile);
  const runDir = path.join(TMP, "run-" + profile + "-" + stamp);
  const userDir = path.join(runDir, "user");
  const wsDir = path.join(runDir, "workspace");
  const guardHome = path.join(runDir, "guard-home");
  fs.mkdirSync(path.join(userDir, "User"), { recursive: true });
  fs.mkdirSync(guardHome, { recursive: true });
  makeWorkspace(wsDir);
  const title = "CGTEST-" + profile + "-" + stamp;
  fs.writeFileSync(path.join(userDir, "User", "settings.json"), JSON.stringify(baseSettings(title), null, 2));

  const versions = ensureExtensions(profile, extDir, installUserDir);
  const port = 19200 + Math.floor(Math.random() * 700); // never 11434
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const variant = extRoot === ROOT ? "" : "-patched";
  const resultsFile = path.join(RESULTS_DIR, profile + variant + ".json");

  console.log(`[runner] profile=${profile} exe=${EXE}`);
  console.log(`[runner] extensions: ${versions.join(", ") || "(none)"}`);
  console.log(`[runner] user-data-dir=${userDir}`);
  console.log(`[runner] workspace=${wsDir}`);

  let exitCode = 0;
  try {
    exitCode = await runTests({
      vscodeExecutablePath: EXE,
      extensionDevelopmentPath: [extRoot, path.join(__dirname, "helper-ext")],
      extensionTestsPath: path.join(__dirname, "suite", "index.js"),
      launchArgs: [
        wsDir,
        "--user-data-dir",
        userDir,
        "--extensions-dir",
        extDir,
        "--remote-debugging-port=" + port,
        "--disable-workspace-trust",
        "--skip-welcome",
        "--skip-release-notes",
        "--new-window",
      ],
      extensionTestsEnv: {
        COMPREHENSION_GUARD_HOME: guardHome,
        CG_PROFILE: profile,
        CG_VARIANT: variant ? "patched" : "real",
        CG_CDP_PORT: String(port),
        CG_WS: wsDir,
        CG_RESULTS: resultsFile,
        CG_EXT_VERSIONS: versions.join(","),
        CG_ONLY: process.env.CG_ONLY || "",
        CG_APPEND: append ? "1" : "0",
        CG_VSCODE_EXE: EXE,
      },
    });
  } catch (err) {
    console.error(`[runner] profile ${profile} failed to run:`, err && err.message ? err.message : err);
    exitCode = 2;
  }
  return { profile, exitCode, resultsFile };
}

async function main() {
  if (!fs.existsSync(EXE)) {
    console.error("VS Code not found at " + EXE + " (set CG_VSCODE_EXE)");
    process.exit(2);
  }
  if (!fs.existsSync(path.join(ROOT, "dist", "extension.js"))) {
    console.error("dist/extension.js missing; run node esbuild.js first");
    process.exit(2);
  }
  const wanted = process.argv.slice(2).filter((a) => PROFILES[a]);
  const profiles = wanted.length ? wanted : Object.keys(PROFILES);
  const variants = [];
  if (!process.argv.includes("--patched-only")) variants.push(ROOT);
  if (process.argv.includes("--patched") || process.argv.includes("--patched-only")) variants.push(await buildPatched());
  let bugs = 0;
  let errors = 0;
  for (const extRoot of variants) for (const profile of profiles) {
    // A scenario can wedge the guard for the rest of the session; the suite then
    // stops and we relaunch a fresh window that continues with the next test.
    let r;
    for (let launch = 0; launch < 12; launch++) {
      r = await runProfile(profile, extRoot, launch > 0);
      if (!fs.existsSync(r.resultsFile)) break;
      const partial = JSON.parse(fs.readFileSync(r.resultsFile, "utf8"));
      if (partial.done) break;
      console.log(`[runner] relaunching ${profile} after wedge in ${partial.wedgedAfter.slice(-1)[0]}`);
    }
    if (fs.existsSync(r.resultsFile)) {
      const data = JSON.parse(fs.readFileSync(r.resultsFile, "utf8"));
      console.log(`\n=== ${profile} (VS Code ${data.vscodeVersion}) ===`);
      for (const row of data.results) {
        console.log(`${row.result.padEnd(9)} ${row.id.padEnd(30)} ${row.observed}`);
        if (row.result === "BUG") bugs++;
        if (row.result === "ERROR") errors++;
      }
    } else {
      errors++;
    }
  }
  console.log(`\n[runner] BUG rows: ${bugs}, ERROR rows: ${errors}. Results in ${RESULTS_DIR}`);
  process.exit(bugs + errors > 0 ? 1 : 0);
}

main();
