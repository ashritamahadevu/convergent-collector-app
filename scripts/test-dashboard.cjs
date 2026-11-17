const esbuild = require("esbuild");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
esbuild.buildSync({
  entryPoints: ["test/dashboard.test.ts"], bundle: true, platform: "node", target: "node22", format: "cjs",
  outfile: "dist/dashboard.test.cjs",
  alias: { vscode: path.resolve("test/network/vscodeStub.ts") },
});
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "--test-force-exit", "dist/dashboard.test.cjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
