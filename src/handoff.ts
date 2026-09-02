// `constly.open` — design §4.2 with §3 rule 1 and §4.7. Collect the target
// URIs, refuse what cannot be handed over, save every dirty target in THIS
// window, detect (or use the cached positive result), launch one path at a
// time in order, then apply `afterOpen`.
import * as path from "node:path";
import * as vscode from "vscode";
import { caretFromZeroBased, fromIdFor, planLaunches } from "./argv";
import type { DetectFn, DetectionCache, Target } from "./detect";
import { DOWNLOAD_URL } from "./identity";
import type { LaunchFn } from "./launch";
import * as M from "./messages";

export type SkipReason = "untitled" | "remote" | "save-failed";

export interface HandOffResult {
  status:
    | "launched"
    | "nothing-to-open"
    | "not-installed"
    | "invalid-path"
    | "flatpak-unreachable"
    | "launch-failed"
    | "web";
  /** Paths handed over, in launch order. */
  launched: string[];
  skipped: { uri: string; reason: SkipReason }[];
  /** The argv of each launch, in order (what the launcher was given). */
  argv: string[][];
  error?: string;
}

export interface HandOffDeps {
  detect: DetectFn;
  launch: LaunchFn;
  cache: DetectionCache;
}

/**
 * VS Code passes `(uri)` from editor menus, `(uri, uris[])` from the
 * Explorer (multi-select), nothing from the Command Palette.
 */
export function collectTargets(uri: unknown, uris: unknown): vscode.Uri[] {
  if (Array.isArray(uris) && uris.length > 0 && uris.every((u) => u instanceof vscode.Uri)) {
    return uris as vscode.Uri[];
  }
  if (uri instanceof vscode.Uri) return [uri];
  const active = vscode.window.activeTextEditor;
  return active ? [active.document.uri] : [];
}

function openDocumentFor(uri: vscode.Uri): vscode.TextDocument | undefined {
  const key = uri.toString();
  return vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
}

export function openDownloadPage(): Thenable<boolean> {
  return vscode.env.openExternal(vscode.Uri.parse(DOWNLOAD_URL));
}

function showFunnel(): void {
  void vscode.window.showInformationMessage(M.notInstalled, M.downloadConstly, M.locate).then((choice) => {
    if (choice === M.downloadConstly) return openDownloadPage();
    if (choice === M.locate) return vscode.commands.executeCommand("constly.locate");
    return undefined;
  });
}

function offerSaveAs(doc: vscode.TextDocument | undefined): void {
  void vscode.window.showInformationMessage(M.untitled, M.saveAs).then(async (choice) => {
    if (choice !== M.saveAs) return;
    if (doc) await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand("workbench.action.files.saveAs");
  });
}

function showLaunchFailed(target: Target): void {
  const where = target.kind === "bundle" ? target.app : target.exe;
  void vscode.window.showErrorMessage(M.launchFailed(where), M.locate, M.download).then((choice) => {
    if (choice === M.locate) return vscode.commands.executeCommand("constly.locate");
    if (choice === M.download) return openDownloadPage();
    return undefined;
  });
}

function showInvalidPath(p: string): void {
  void vscode.window.showErrorMessage(M.invalidPath(p), M.locate).then((choice) => {
    if (choice === M.locate) return vscode.commands.executeCommand("constly.locate");
    return undefined;
  });
}

async function closeTabsShowing(uris: readonly vscode.Uri[]): Promise<void> {
  const wanted = new Set(uris.map((u) => u.toString()));
  const tabs: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText && wanted.has(tab.input.uri.toString())) tabs.push(tab);
    }
  }
  if (tabs.length > 0) await vscode.window.tabGroups.close(tabs, true);
}

export async function handOff(uriArg: unknown, urisArg: unknown, deps: HandOffDeps): Promise<HandOffResult> {
  const result: HandOffResult = { status: "nothing-to-open", launched: [], skipped: [], argv: [] };

  if (vscode.env.uiKind === vscode.UIKind.Web) {
    void vscode.window.showInformationMessage(M.notInBrowser);
    return { ...result, status: "web" };
  }

  const targets = collectTargets(uriArg, urisArg);
  if (targets.length === 0) {
    void vscode.window.showInformationMessage(M.nothingToOpen);
    return result;
  }

  // §3 rule 1: save before hand-off, for every target, from every entry point.
  const files: vscode.Uri[] = [];
  for (const uri of targets) {
    if (uri.scheme === "untitled") {
      result.skipped.push({ uri: uri.toString(), reason: "untitled" });
      offerSaveAs(openDocumentFor(uri));
      continue;
    }
    if (uri.scheme !== "file") {
      result.skipped.push({ uri: uri.toString(), reason: "remote" });
      void vscode.window.showInformationMessage(M.remoteFile);
      continue;
    }
    const doc = openDocumentFor(uri);
    if (doc?.isDirty) {
      const saved = await doc.save();
      if (!saved) {
        result.skipped.push({ uri: uri.toString(), reason: "save-failed" });
        void vscode.window.showWarningMessage(M.saveFailed(path.basename(uri.fsPath)));
        continue;
      }
    }
    files.push(uri);
  }
  if (files.length === 0) return result;

  // Detection: a cached positive result, else probe now (never at activation).
  const config = vscode.workspace.getConfiguration("constly");
  const configuredPath = config.get<string>("path", "");
  let target = deps.cache.get(configuredPath);
  if (!target) {
    const detection = await deps.detect(configuredPath);
    switch (detection.kind) {
      case "found":
        target = detection.target;
        deps.cache.set(configuredPath, target);
        break;
      case "not-found":
        showFunnel();
        return { ...result, status: "not-installed" };
      case "invalid-path":
        showInvalidPath(detection.path);
        return { ...result, status: "invalid-path" };
      case "flatpak-unreachable":
        void vscode.window.showInformationMessage(M.flatpakUnreachable);
        return { ...result, status: "flatpak-unreachable" };
    }
  }

  // Caret only when invoked from the editor showing the first path.
  const editor = vscode.window.activeTextEditor;
  const showsFirst = editor !== undefined && editor.document.uri.toString() === files[0].toString();
  const goto =
    showsFirst && config.get<boolean>("passCaret", true)
      ? caretFromZeroBased(editor.selection.active.line, editor.selection.active.character)
      : undefined;
  const plan = planLaunches(
    files.map((u) => u.fsPath),
    { goto, from: fromIdFor(vscode.env.uriScheme) },
  );

  for (const launch of plan) {
    try {
      await deps.launch({ target, path: launch.path, argv: launch.argv });
    } catch (err) {
      showLaunchFailed(target);
      return { ...result, status: "launch-failed", error: err instanceof Error ? err.message : String(err) };
    }
    result.launched.push(launch.path);
    result.argv.push(launch.argv);
  }

  if (config.get<string>("afterOpen", "close") === "close") {
    await closeTabsShowing(files);
  }
  return { ...result, status: "launched" };
}
