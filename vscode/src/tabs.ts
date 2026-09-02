// The one thing activate() is allowed to look at besides registering handlers:
// a snapshot of the tabs VS Code restored before the user's first click.
// `onStartupFinished` places activation after editor restore, so any Constly
// placeholder tab (B2's custom editor) present now was restored, not opened by
// a user gesture, and must never launch Constly. B1 ships no custom editor, so
// the set is empty in practice; the scaffolding exists so B2 inherits the
// timing rather than re-deriving it.
import * as vscode from "vscode";
import { PLACEHOLDER_VIEW_TYPE } from "./identity";

export function snapshotRestoredPlaceholders(tabGroups: vscode.TabGroups): ReadonlySet<string> {
  const restored = new Set<string>();
  for (const group of tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputCustom && input.viewType === PLACEHOLDER_VIEW_TYPE) {
        restored.add(input.uri.toString());
      }
    }
  }
  return restored;
}
