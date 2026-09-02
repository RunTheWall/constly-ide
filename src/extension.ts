// Constly for VS Code — the bridge (docs/DESIGN-ide-extensions.md §4).
//
// E4: the extension does nothing on its own. activate() takes the tab snapshot
// and registers commands and handlers, and that is all: no filesystem access,
// no process spawn, no reading of `constly.path`'s target, no detection —
// every probe waits for a user command. The activation test enforces this with
// spies on `fs` and `child_process`, and the activation self-test proves the
// test can fail by building this file with __CONSTLY_ACTIVATION_PROBE__ = true.
import * as vscode from "vscode";
import { classifyPath, detectConstly, DetectionCache, type DetectFn } from "./detect";
import { handOff, openDownloadPage, type HandOffResult } from "./handoff";
import { createLauncher, type LaunchFn } from "./launch";
import * as M from "./messages";
import { nodeLaunchDeps, nodeProbeDeps } from "./platform";
import { snapshotRestoredPlaceholders } from "./tabs";

/**
 * The exported API (`extension.exports`). `test` is the seam the integration
 * tests use so no real Constly is ever spawned; there is nothing else here for
 * other extensions yet.
 */
export interface ConstlyExtensionApi {
  readonly apiVersion: 1;
  readonly test: {
    /** Replace detection (pass undefined to restore the real one). */
    setDetector(detect: DetectFn | undefined): void;
    /** Replace the per-path launcher (pass undefined to restore the real one). */
    setLauncher(launch: LaunchFn | undefined): void;
    /** Forget the cached positive detection. */
    resetDetectionCache(): void;
    /** URIs of placeholder tabs present when this window activated (B2 input). */
    restoredPlaceholderTabs(): ReadonlySet<string>;
  };
}

const defaultDetect: DetectFn = (configuredPath) => detectConstly(configuredPath, nodeProbeDeps());

export function activate(context: vscode.ExtensionContext): ConstlyExtensionApi {
  if (__CONSTLY_ACTIVATION_PROBE__) {
    activationProbe();
  }

  const restoredPlaceholders = snapshotRestoredPlaceholders(vscode.window.tabGroups);
  const cache = new DetectionCache();
  const overrides: { detect: DetectFn | undefined; launch: LaunchFn | undefined } = {
    detect: undefined,
    launch: undefined,
  };
  let realLauncher: LaunchFn | undefined;
  const launcher = (): LaunchFn => {
    if (overrides.launch) return overrides.launch;
    realLauncher ??= createLauncher(nodeLaunchDeps());
    return realLauncher;
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("constly.path")) cache.clear();
    }),
    vscode.commands.registerCommand(
      "constly.open",
      (uri?: unknown, uris?: unknown): Promise<HandOffResult> =>
        handOff(uri, uris, { detect: overrides.detect ?? defaultDetect, launch: launcher(), cache }),
    ),
    vscode.commands.registerCommand("constly.locate", () => locateConstly(cache)),
    vscode.commands.registerCommand("constly.install", () => openDownloadPage()),
    // B4 registers the real return-trip handler; until then a link that
    // activates us gets an honest answer instead of VS Code's own error.
    vscode.window.registerUriHandler({
      handleUri: () => {
        void vscode.window.showInformationMessage(M.uriNotSupported);
      },
    }),
  );

  return {
    apiVersion: 1,
    test: {
      setDetector: (detect) => {
        overrides.detect = detect;
      },
      setLauncher: (launch) => {
        overrides.launch = launch;
      },
      resetDetectionCache: () => cache.clear(),
      restoredPlaceholderTabs: () => restoredPlaceholders,
    },
  };
}

export function deactivate(): void {
  // Nothing to tear down: no watchers, no long-lived children (a hand-off
  // into a running Constly exits at once; a cold start is LaunchServices' or
  // a detached process's, not ours).
}

/** `constly.locate`: file/app picker → validated per §4.5 "all" row → `constly.path` at machine scope. */
async function locateConstly(cache: DetectionCache): Promise<void> {
  const deps = nodeProbeDeps();
  const picked = await vscode.window.showOpenDialog({
    title: "Locate Constly",
    openLabel: "Use this Constly",
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    ...(deps.platform === "darwin" ? { defaultUri: vscode.Uri.file("/Applications") } : {}),
  });
  const chosen = picked?.[0];
  if (!chosen) return;
  const target = classifyPath(chosen.fsPath, deps);
  if (!target) {
    void vscode.window.showErrorMessage(M.invalidPath(chosen.fsPath));
    return;
  }
  // "machine" scope lives in the user settings file; ConfigurationTarget.Global is its writer.
  await vscode.workspace.getConfiguration("constly").update("path", chosen.fsPath, vscode.ConfigurationTarget.Global);
  cache.clear();
  void vscode.window.showInformationMessage(M.located(chosen.fsPath, target.kind === "binary" && target.degraded));
}

/**
 * SELF-TEST ONLY. A deliberate E4 violation: the kind of "just check whether
 * Constly is installed" a status-bar item would do at start-up. Present only
 * in the bundle built with `--activation-probe`; the production bundle must
 * not contain the marker string below (scripts/check-package.sh greps for it).
 */
function activationProbe(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("node:os") as typeof import("node:os");
  // The marker is a live string (a comment would not survive minification);
  // the guard scripts grep the bundle for it.
  const marker = "constly-activation-probe";
  fs.existsSync(`${os.homedir()}/Applications/Constly.app/${marker}`);
}
