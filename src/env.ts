// The child gets a sanitised copy of the IDE's environment. An Electron host
// exports variables that make a spawned Node-aware binary misbehave
// (ELECTRON_RUN_AS_NODE, NODE_OPTIONS) and a snap/Flatpak/AppImage IDE exports
// GTK/GIO/LD paths that break a WebKitGTK app at startup.

const DROP_EXACT_ALL = new Set(["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"]);
const DROP_PREFIX_ALL = ["ELECTRON_", "VSCODE_"];
const DROP_EXACT_LINUX = new Set([
  "GTK_PATH",
  "GTK_EXE_PREFIX",
  "GIO_MODULE_DIR",
  "GSETTINGS_SCHEMA_DIR",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
]);

export function shouldDropEnvVar(name: string, platform: NodeJS.Platform): boolean {
  // Windows environment names are case-insensitive; elsewhere they are not,
  // and a user's own lower-case variable is none of our business.
  const key = platform === "win32" ? name.toUpperCase() : name;
  if (DROP_EXACT_ALL.has(key)) return true;
  if (DROP_PREFIX_ALL.some((p) => key.startsWith(p))) return true;
  if (platform === "linux" && DROP_EXACT_LINUX.has(key)) return true;
  return false;
}

export function sanitisedEnv(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (shouldDropEnvVar(name, platform)) continue;
    out[name] = value;
  }
  return out;
}
