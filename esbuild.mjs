// Bundles src/extension.ts → dist/extension.js: one CommonJS file, `vscode`
// external, minified, no sourcemap in the package, zero runtime dependencies.
//
//   node esbuild.mjs                     production bundle
//   node esbuild.mjs --watch             rebuild on change (adds a sourcemap)
//   node esbuild.mjs --activation-probe  POISONED bundle for the activation
//                                        self-test: activate() runs a probe,
//                                        which the E4 activation test must
//                                        catch. Never shipped — the flag is a
//                                        build-time `define`, and the probe is
//                                        dead-code-eliminated from the
//                                        production bundle (scripts/
//                                        check-package.sh greps for its marker).
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const activationProbe = process.argv.includes("--activation-probe");

/** @type {esbuild.BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  legalComments: "none",
  logLevel: "info",
  define: {
    __CONSTLY_ACTIVATION_PROBE__: activationProbe ? "true" : "false",
  },
};

if (activationProbe) {
  console.warn("esbuild: building the POISONED activation-probe bundle (self-test only)");
}

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
