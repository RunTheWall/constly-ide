// Every user-visible string — design §4.7. Functional, Constly-branded, never
// comparative, never shown except in response to a user command.

export const notInstalled =
  "Constly: Constly is not installed (or wasn't found). Install it to open Markdown in Constly.";
export const downloadConstly = "Download Constly";
export const locate = "Locate…";
export const download = "Download";
export const saveAs = "Save As…";

export const remoteFile = "Constly opens files on this machine; this file lives in a remote workspace.";
export const notInBrowser = "Constly: Open in Constly is not available in the browser.";
export const untitled = "Save the file first so Constly can open it.";
export const flatpakUnreachable =
  "Constly can't be reached from a Flatpak-sandboxed IDE (flatpak-spawn --host is not available to it).";
export const nothingToOpen = "Constly: open a file first, then run \"Open in Constly\".";
export const uriNotSupported = "Constly: links into VS Code are not supported by this version of the extension.";

export function saveFailed(fileName: string): string {
  return `Constly: ${fileName} couldn't be saved, so it wasn't opened in Constly.`;
}

export function launchFailed(where: string): string {
  return `Constly: couldn't start Constly at ${where}`;
}

export function invalidPath(p: string): string {
  return `Constly: "${p}" (constly.path) isn't a Constly app bundle or an executable file.`;
}

export function located(p: string, degraded: boolean): string {
  return degraded
    ? `Constly: using ${p}. A bare binary runs as a child of VS Code; point constly.path at Constly.app for the normal mode.`
    : `Constly: using ${p}.`;
}
