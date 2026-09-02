// Every name that ties this extension to the product or to a registry lives
// either here or in package.json (publisher / name / displayName / repository /
// bugs / homepage). When the registered ids land, each is a one-line change.

/** `publisher.name` from package.json — what `vscode.extensions.getExtension` wants. */
export const EXTENSION_ID = "constly.constly";

/** Where the install funnel sends people. `ref` is a plain query parameter for the site's own analytics; nothing in the extension phones home. */
export const DOWNLOAD_URL = "https://constly.com/download?ref=vscode";

/** macOS bundle identity (src-tauri/tauri.conf.json `identifier`). */
export const MAC_BUNDLE_ID = "com.constly.app";
export const MAC_APP_BUNDLE = "Constly.app";
/** `<app>/Contents/MacOS/<this>` — the inner binary that reaches a running instance. */
export const MAC_INNER_BINARY = "constly";

/** Windows: the NSIS Uninstall key leaf is the product name; the exe is already suffixed. */
export const WINDOWS_UNINSTALL_KEY = "Constly";
export const WINDOWS_EXE = "constly.exe";
export const WINDOWS_LOCALAPPDATA_DIR = "Constly";

/** Linux: deb/rpm/tar all install here; nothing goes to /opt. */
export const LINUX_BINARY = "constly";
export const LINUX_USR_BIN = "/usr/bin/constly";

/** `--from=<id>` grammar (IDE contract v1). The raw `vscode.env.uriScheme` is sent only if it matches. */
export const IDE_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** B2's custom editor view type — B1 only snapshots such tabs at activation. */
export const PLACEHOLDER_VIEW_TYPE = "constly.editor";

/** Contract version this bridge was written against; the README states it. */
export const CARET_NEEDS_CONSTLY = "4.7.0";
