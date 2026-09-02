// The E4 activation test (design §4.9). The extension activates on
// `onStartupFinished`; activate() may register commands and take the tab
// snapshot, and nothing else — no filesystem access, no process spawn.
//
// How it looks: at module load — the earliest moment the harness gets inside
// the extension host — every function on `fs`, `fs.promises` and
// `child_process` is wrapped in a spy that counts calls whose stack passes
// through this extension's bundle (dist/extension.js). Calls from VS Code
// itself, mocha, or this file do not count; calls the extension makes through
// its own helpers do. Then the test waits for the extension to activate on its
// own and asserts zero; runs one bridge command and asserts non-zero (the
// positive control of the spies); and refuses to report a pass when it could
// not have seen activation at all (the extension was already active when the
// spies went in — a could-not-look, not a pass).
//
// The modules are taken with `require`, deliberately: `import * as fs` under
// tsc's esModuleInterop yields a getter-only namespace wrapper, and wrapping
// THAT patches nothing while looking like it did (the first version of this
// file failed exactly so — and the positive control caught it). installSpies
// therefore also refuses to proceed when it wrapped nothing.
//
// scripts/activation-self-test.sh proves the harness: the same test must FAIL
// against the bundle built with `--activation-probe`, and its failure must
// carry the E4-VIOLATION marker so a failure for any other reason (download,
// harness, could-not-look) is never mistaken for the expected one.
import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ConstlyExtensionApi } from "../../src/extension";
import { EXTENSION_ID, makeTempDir, sleep, waitFor, writeFile } from "../shared/harness";

/* eslint-disable @typescript-eslint/no-require-imports */
const realFs = require("node:fs") as typeof import("node:fs");
const realCp = require("node:child_process") as typeof import("node:child_process");
/* eslint-enable @typescript-eslint/no-require-imports */

interface Observed {
  module: string;
  fn: string;
  frame: string;
}

const observed: Observed[] = [];
const spies = new WeakSet<object>();
const extension = vscode.extensions.getExtension<ConstlyExtensionApi>(EXTENSION_ID);
const activeAtLoad = extension?.isActive === true;
const bundleDir = extension ? path.join(extension.extensionPath, "dist") : "<extension not found>";
const bundleMarkers = [path.join("dist", "extension.js"), "dist/extension.js"];

function fromBundle(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  return stack
    .split("\n")
    .map((l) => l.trim())
    .find((l) => bundleMarkers.some((m) => l.includes(m)) || l.includes(bundleDir));
}

/** Wrap every writable function-valued own property of `target`; returns how many were wrapped. */
function installSpies(target: object, moduleName: string): number {
  let wrapped = 0;
  for (const key of Object.keys(target)) {
    const desc = Object.getOwnPropertyDescriptor(target, key);
    if (!desc || typeof desc.value !== "function" || !desc.writable) continue;
    const original = desc.value as (...a: unknown[]) => unknown;
    const spy = function (this: unknown, ...args: unknown[]): unknown {
      const frame = fromBundle(new Error().stack);
      if (frame) observed.push({ module: moduleName, fn: key, frame });
      return original.apply(this, args);
    };
    Object.defineProperty(spy, "name", { value: original.name });
    // Keep static members (fs.realpath.native, util.promisify.custom, …).
    for (const staticKey of Object.keys(original)) {
      (spy as unknown as Record<string, unknown>)[staticKey] = (original as unknown as Record<string, unknown>)[staticKey];
    }
    (target as Record<string, unknown>)[key] = spy;
    spies.add(spy);
    wrapped += 1;
  }
  return wrapped;
}

const spiesInstalled = {
  child_process: installSpies(realCp, "child_process"),
  fs: installSpies(realFs, "fs"),
  "fs.promises": installSpies(realFs.promises, "fs.promises"),
};
// What the extension will call must be OUR functions, on the module object
// every `require("fs")` / `require("node:fs")` in this process hands out.
/* eslint-disable @typescript-eslint/no-require-imports */
const spiesAreReal =
  spies.has(realFs.existsSync) &&
  spies.has(realFs.statSync) &&
  spies.has(realCp.spawn) &&
  spies.has(realCp.execFile) &&
  (require("fs") as typeof import("node:fs")).existsSync === realFs.existsSync &&
  (require("child_process") as typeof import("node:child_process")).execFile === realCp.execFile;
/* eslint-enable @typescript-eslint/no-require-imports */

function summary(): string {
  const byFn = new Map<string, number>();
  for (const o of observed) byFn.set(`${o.module}.${o.fn}`, (byFn.get(`${o.module}.${o.fn}`) ?? 0) + 1);
  return [...byFn].map(([k, n]) => `${k}×${n}`).join(", ") || "(none)";
}

suite("E4 — the extension does nothing on its own", () => {
  test("activate() neither touches the filesystem nor spawns; the first user command does", async function () {
    this.timeout(180_000);
    assert.ok(extension, `extension ${EXTENSION_ID} is installed in the test host`);
    for (const [name, n] of Object.entries(spiesInstalled)) {
      assert.ok(n > 0, `COULD-NOT-LOOK: no spies could be installed on ${name} (wrapped ${n}) — the harness is not watching anything`);
    }
    assert.ok(spiesAreReal, "COULD-NOT-LOOK: fs/child_process do not hand out the installed spies — the harness is watching a copy");
    assert.equal(
      activeAtLoad,
      false,
      "COULD-NOT-LOOK: the extension was already active when the spies were installed, so activate() was not observed. Fix the harness ordering; this is not a pass.",
    );

    // onStartupFinished is the extension's only start-up activation event, so
    // "became active without us asking" is the event under test.
    await waitFor(() => extension.isActive, 150_000, "the extension to activate via onStartupFinished");
    // Let any activation-time async work (a deferred probe would be one) surface.
    await sleep(3_000);

    assert.equal(
      observed.length,
      0,
      `E4-VIOLATION: activate() reached fs/child_process — ${summary()}\n  first frame: ${observed[0]?.frame ?? ""}`,
    );

    // Positive control: a user command must probe (detection) — through the
    // very functions the spies wrap — otherwise the zero above proves nothing.
    const api = extension.exports;
    api.test.setLauncher(async () => undefined); // observe detection, never start a real Constly
    const tmp = makeTempDir("constly-activation-");
    const file = writeFile(tmp, "probe.md", "# hello\n");
    try {
      await vscode.commands.executeCommand("constly.open", vscode.Uri.file(file));
      await waitFor(() => observed.length > 0, 10_000, "a probe after the first user command");
      assert.ok(observed.length > 0, `the command should have probed via fs/child_process; observed: ${summary()}`);
      assert.ok(
        observed.some((o) => o.module === "fs" || o.module === "child_process"),
        `probes must come from the wrapped modules; observed: ${summary()}`,
      );
      console.log(`activation test: after the first command the extension probed via ${summary()}`);
    } finally {
      api.test.setLauncher(undefined);
      realFs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
