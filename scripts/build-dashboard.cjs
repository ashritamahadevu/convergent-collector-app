const esbuild = require("esbuild");
const { assertDashboardRuntime } = require("./check-dashboard-runtime.cjs");
esbuild.buildSync({
  entryPoints: ["desktop/backend/cli.ts"], bundle: true, platform: "node", target: "node22",
  format: "cjs", outfile: "dist/dashboard-backend.cjs", sourcemap: true,
  banner: { js: "(" + assertDashboardRuntime.toString() + ")();" },
});
