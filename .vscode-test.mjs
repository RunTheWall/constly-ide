import { defineConfig } from "@vscode/test-cli";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Two launches of VS Code, on purpose. The activation (E4) test must observe
// the extension's FIRST activation in a process where no bridge command has
// run yet, so it cannot share a VS Code instance with the command tests.
// `--disable-extensions` keeps other extensions (and their process spawns) out
// of the picture; the extension under development still loads.
//
// The user-data-dir is a short temp path rather than the default under
// .vscode-test/: VS Code binds a Unix socket inside it, and a deep checkout
// (a git worktree, a nested CI workspace) pushes that path past the 103-char
// limit — "listen EINVAL" before a single test runs.
function shortUserDataDir(label) {
  const base = process.platform === "win32" ? os.tmpdir() : fs.existsSync("/tmp") ? "/tmp" : os.tmpdir();
  return fs.mkdtempSync(path.join(base, `cvt-${label}-`));
}

const common = {
  version: "stable",
  workspaceFolder: "./test/fixtures/workspace",
  mocha: { ui: "tdd", timeout: 60_000, color: true },
};

const launchArgs = (label) => ["--disable-extensions", "--disable-workspace-trust", "--user-data-dir", shortUserDataDir(label)];

export default defineConfig([
  {
    label: "integration",
    files: "out/test/integration/**/*.test.js",
    launchArgs: launchArgs("int"),
    ...common,
  },
  {
    label: "activation",
    files: "out/test/activation/**/*.test.js",
    launchArgs: launchArgs("act"),
    ...common,
  },
]);
