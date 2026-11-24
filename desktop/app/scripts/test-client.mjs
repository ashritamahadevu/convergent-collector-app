import { build } from "esbuild";
import { spawnSync } from "node:child_process";

await build({
  entryPoints: ["test/client.test.ts"], bundle: true, platform: "node",
  format: "cjs", target: "node22", outfile: "build/client.test.cjs",
});
const result = spawnSync(process.execPath, ["--test", "build/client.test.cjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
