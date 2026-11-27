import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Publishes the Windows desktop installer and the extension VSIX to one GitHub
// release, then points the website at those files. Requires GH_TOKEN (or
// GITHUB_TOKEN). The token is used only by this script and is not put in the app.
// Do not publish a newer GitHub release that omits latest.yml and the Windows
// installer. The installed app treats the latest release as the update feed.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = "ashritamahadevu/convergent-collector-app";
const desktopDir = path.join(root, "desktop", "app");
const releasesPath = path.join(root, "website", "releases.json");

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  console.error("Set GH_TOKEN to a token that can publish GitHub releases. The token is not stored in the app.");
  process.exit(1);
}
process.env.GH_TOKEN = token;

const desktop = readJson(path.join(desktopDir, "package.json"));
const extension = readJson(path.join(root, "package.json"));
if (!/^\d+\.\d+\.\d+$/.test(desktop.version) || !/^\d+\.\d+\.\d+$/.test(extension.version)) {
  console.error("Desktop and extension versions must be numeric semver, like 0.1.0.");
  process.exit(1);
}

const tag = `v${desktop.version}`;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
run(npm, ["run", "build"], desktopDir, true);
run(npm, ["exec", "--", "electron-builder", "--win", "--publish", "always"], desktopDir, true);
run(npm, ["run", "package"], root, true);

const vsixName = `comprehension-guard-${extension.version}.vsix`;
const vsix = path.join(root, vsixName);
if (!fs.existsSync(vsix)) {
  console.error("Missing " + vsix + " after packaging the extension.");
  process.exit(1);
}
run("gh", ["release", "upload", tag, vsix, "--clobber", "--repo", repo], root, false);

const current = fs.existsSync(releasesPath) ? readJson(releasesPath) : {};
const mac = typeof current.desktop?.mac === "string" && current.desktop.mac ? current.desktop.mac : null;
const releases = {
  desktop: {
    version: desktop.version,
    windows: `https://github.com/${repo}/releases/download/${tag}/DrawBridge-Setup-${desktop.version}.exe`,
    mac,
  },
  extension: {
    version: extension.version,
    vsix: `https://github.com/${repo}/releases/download/${tag}/${vsixName}`,
  },
};
fs.writeFileSync(releasesPath, JSON.stringify(releases, null, 2) + "\n");
console.log("Updated website/releases.json for " + tag + ".");
console.log("Commit that file and push so the site shows this release. mac stays empty until a Mac build sets it.");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function run(command, args, cwd, shell) {
  execFileSync(command, args, { cwd, stdio: "inherit", env: process.env, shell });
}
