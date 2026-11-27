import { build } from "esbuild";

await build({
  entryPoints: { main: "electron/main.ts", preload: "electron/preload.ts" },
  bundle: true, platform: "node", format: "cjs", target: "node22",
  external: ["electron", "electron-updater"], outdir: "build", outExtension: { ".js": ".cjs" },
});
