const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * Emits the markers that the VS Code task's inline problem matcher looks for
 * (`[watch] build started` / `[watch] build finished`) and prints esbuild
 * errors in a single-line, matcher-friendly format. This removes the need for
 * the external `connor4312.esbuild-problem-matchers` extension.
 */
const problemMatcherPlugin = {
  name: "problem-matcher",
  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        if (location) {
          console.error(
            `\u2718 [ERROR] ${text} [${location.file}:${location.line}:${location.column}]`,
          );
        } else {
          console.error(`\u2718 [ERROR] ${text}`);
        }
      }
      console.log("[watch] build finished");
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.js",
    // The 'vscode' module is provided by the extension host at runtime.
    external: ["vscode"],
    logLevel: "silent",
    plugins: [problemMatcherPlugin],
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
