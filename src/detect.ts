// Detection — design §4.5. Runs only from a user command. Yields a launch
// target: on macOS preferably the .app bundle plus its inner executable,
// elsewhere an executable path. Never reads a version (§2.3). No shell
// anywhere, so `~` and `%LOCALAPPDATA%` are expanded here.
import * as path from "node:path";
import {
  LINUX_BINARY,
  LINUX_USR_BIN,
  MAC_APP_BUNDLE,
  MAC_BUNDLE_ID,
  MAC_INNER_BINARY,
  WINDOWS_EXE,
  WINDOWS_LOCALAPPDATA_DIR,
  WINDOWS_UNINSTALL_KEY,
} from "./identity";
import type { ProbeDeps } from "./platform";

export type Target =
  /** A macOS app bundle: `open -a` for a cold start, the inner binary for a running instance. */
  | { kind: "bundle"; app: string; exe: string }
  /**
   * An executable. `degraded` marks a bare binary on macOS (no bundle, so it
   * is exec'd in both cases and runs as a detached child of the IDE).
   * `wrapper` prefixes the command line (Flatpak: `flatpak-spawn --host`).
   */
  | { kind: "binary"; exe: string; degraded: boolean; wrapper?: readonly string[] };

export type DetectionSource =
  | "setting"
  | "applications"
  | "user-applications"
  | "mdfind"
  | "registry-hkcu"
  | "registry-hklm"
  | "localappdata"
  | "where"
  | "which"
  | "usr-bin"
  | "flatpak-which"
  | "flatpak-usr-bin";

export type Detection =
  | { kind: "found"; target: Target; source: DetectionSource }
  | { kind: "not-found" }
  /** `constly.path` is set but is neither a bundle nor an executable file. */
  | { kind: "invalid-path"; path: string }
  /** The IDE is Flatpak-sandboxed and `flatpak-spawn --host` does not work. */
  | { kind: "flatpak-unreachable" };

export type DetectFn = (configuredPath: string) => Promise<Detection>;

export const FLATPAK_INFO = "/.flatpak-info";
export const FLATPAK_SPAWN = "flatpak-spawn";
export const FLATPAK_HOST_WRAPPER: readonly string[] = [FLATPAK_SPAWN, "--host"];

// ---------------------------------------------------------------- expansion

/** `~` and `~/x` → the home directory (only a leading tilde; `~user` is left alone). */
export function expandHome(p: string, homedir: string): string {
  if (p === "~") return homedir;
  if (p.startsWith("~/") || p.startsWith("~\\")) return homedir + p.slice(1);
  return p;
}

/** `%VAR%` → its value (Windows-style); unknown variables are left as written. */
export function expandWindowsEnv(p: string, env: Readonly<Record<string, string | undefined>>): string {
  return p.replace(/%([^%]+)%/g, (whole, name: string) => {
    const hit = Object.entries(env).find(([k]) => k.toUpperCase() === name.toUpperCase());
    return hit?.[1] ?? whole;
  });
}

export function expandPath(p: string, deps: Pick<ProbeDeps, "homedir" | "env">): string {
  return expandHome(expandWindowsEnv(p.trim(), deps.env), deps.homedir());
}

// ---------------------------------------------------------------- classify

/** `<app>/Contents/MacOS/constly` — POSIX joins because a bundle is a macOS path wherever this runs. */
export function innerBinaryOf(app: string): string {
  return path.posix.join(app, "Contents", "MacOS", MAC_INNER_BINARY);
}

function stripTrailingSlash(p: string): string {
  return p.length > 1 ? p.replace(/[\\/]+$/, "") : p;
}

/**
 * The "all" row of §4.5: an explicit path is a bundle (target = the bundle,
 * executable = its inner binary) or an existing executable file — a directory
 * that is not a bundle is not a target (spawning it fails with EACCES). Shared
 * by `constly.path` and the Locate… command.
 */
export function classifyPath(rawPath: string, deps: ProbeDeps): Target | undefined {
  const p = stripTrailingSlash(expandPath(rawPath, deps));
  if (p === "") return undefined;
  if (/\.app$/i.test(p) && deps.isDirectory(p)) {
    const exe = innerBinaryOf(p);
    return deps.isExecutableFile(exe) ? { kind: "bundle", app: p, exe } : undefined;
  }
  if (deps.isExecutableFile(p)) {
    return { kind: "binary", exe: p, degraded: deps.platform === "darwin" };
  }
  return undefined;
}

// ---------------------------------------------------------------- per-OS

function bundleAt(app: string, deps: ProbeDeps): Target | undefined {
  const exe = innerBinaryOf(app);
  return deps.isExecutableFile(exe) ? { kind: "bundle", app, exe } : undefined;
}

async function detectMac(deps: ProbeDeps): Promise<Detection> {
  const userApplications = path.posix.join(deps.homedir(), "Applications");
  const system = bundleAt(path.posix.join("/Applications", MAC_APP_BUNDLE), deps);
  if (system) return { kind: "found", target: system, source: "applications" };
  const user = bundleAt(path.posix.join(userApplications, MAC_APP_BUNDLE), deps);
  if (user) return { kind: "found", target: user, source: "user-applications" };

  // Scoped: an unscoped mdfind returns a developer's stale target/ bundles first.
  const r = await deps.run("mdfind", [
    "-onlyin",
    "/Applications",
    "-onlyin",
    userApplications,
    `kMDItemCFBundleIdentifier == '${MAC_BUNDLE_ID}'`,
  ]);
  if (r.status === 0) {
    for (const line of r.stdout.split("\n")) {
      const candidate = line.trim();
      if (!candidate.endsWith(".app")) continue;
      const found = bundleAt(candidate, deps);
      if (found) return { kind: "found", target: found, source: "mdfind" };
    }
  }
  return { kind: "not-found" };
}

/** Values of one `reg query` listing: `    Name    REG_SZ    value`. */
export function parseRegQuery(stdout: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s+(\S+)\s+REG_[A-Z_]+\s*(.*?)\s*$/.exec(line);
    if (m) values[m[1]] = m[2];
  }
  return values;
}

/** `InstallLocation` is written with literal surrounding quotes by Tauri's NSIS template. */
export function stripQuotes(value: string): string {
  const v = value.trim();
  return v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
}

function windowsSystemTool(deps: ProbeDeps, exe: string): string {
  const root = deps.env.SystemRoot ?? deps.env.SYSTEMROOT ?? deps.env.windir;
  return root ? path.win32.join(root, "System32", exe) : exe;
}

async function windowsUninstallEntry(
  hive: "HKCU" | "HKLM",
  deps: ProbeDeps,
): Promise<Target | undefined> {
  const key = `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${WINDOWS_UNINSTALL_KEY}`;
  const r = await deps.run(windowsSystemTool(deps, "reg.exe"), ["query", key]);
  if (r.status !== 0) return undefined;
  const values = parseRegQuery(r.stdout);
  const location = values.InstallLocation ? stripQuotes(values.InstallLocation) : "";
  if (!location) return undefined;
  const binary = values.MainBinaryName ? stripQuotes(values.MainBinaryName) : WINDOWS_EXE;
  const exe = path.win32.join(location, binary);
  return deps.isExecutableFile(exe) ? { kind: "binary", exe, degraded: false } : undefined;
}

async function detectWindows(deps: ProbeDeps): Promise<Detection> {
  const hkcu = await windowsUninstallEntry("HKCU", deps);
  if (hkcu) return { kind: "found", target: hkcu, source: "registry-hkcu" };
  const hklm = await windowsUninstallEntry("HKLM", deps);
  if (hklm) return { kind: "found", target: hklm, source: "registry-hklm" };

  const localAppData = deps.env.LOCALAPPDATA ?? deps.env.LocalAppData;
  if (localAppData) {
    const exe = path.win32.join(localAppData, WINDOWS_LOCALAPPDATA_DIR, WINDOWS_EXE);
    if (deps.isExecutableFile(exe)) {
      return { kind: "found", target: { kind: "binary", exe, degraded: false }, source: "localappdata" };
    }
  }

  const r = await deps.run(windowsSystemTool(deps, "where.exe"), [LINUX_BINARY]);
  if (r.status === 0) {
    const first = r.stdout.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "");
    if (first && deps.isExecutableFile(first)) {
      return { kind: "found", target: { kind: "binary", exe: first, degraded: false }, source: "where" };
    }
  }
  return { kind: "not-found" };
}

async function detectLinuxFlatpak(deps: ProbeDeps): Promise<Detection> {
  // Inside the sandbox `which`, /usr/bin and spawn all resolve to the sandbox's
  // own view. Everything goes through the host portal — if it answers at all.
  const ping = await deps.run(FLATPAK_SPAWN, ["--host", "true"]);
  if (ping.status !== 0) return { kind: "flatpak-unreachable" };

  const which = await deps.run(FLATPAK_SPAWN, ["--host", "which", LINUX_BINARY]);
  if (which.status === 0) {
    const first = which.stdout.split("\n").map((l) => l.trim()).find((l) => l !== "");
    if (first) {
      return {
        kind: "found",
        target: { kind: "binary", exe: first, degraded: false, wrapper: FLATPAK_HOST_WRAPPER },
        source: "flatpak-which",
      };
    }
  }
  const usrBin = await deps.run(FLATPAK_SPAWN, ["--host", "test", "-x", LINUX_USR_BIN]);
  if (usrBin.status === 0) {
    return {
      kind: "found",
      target: { kind: "binary", exe: LINUX_USR_BIN, degraded: false, wrapper: FLATPAK_HOST_WRAPPER },
      source: "flatpak-usr-bin",
    };
  }
  return { kind: "not-found" };
}

async function detectLinux(deps: ProbeDeps): Promise<Detection> {
  if (deps.exists(FLATPAK_INFO)) return detectLinuxFlatpak(deps);

  const r = await deps.run("which", [LINUX_BINARY]);
  if (r.status === 0) {
    const first = r.stdout.split("\n").map((l) => l.trim()).find((l) => l !== "");
    if (first && deps.isExecutableFile(first)) {
      return { kind: "found", target: { kind: "binary", exe: first, degraded: false }, source: "which" };
    }
  }
  if (deps.isExecutableFile(LINUX_USR_BIN)) {
    return { kind: "found", target: { kind: "binary", exe: LINUX_USR_BIN, degraded: false }, source: "usr-bin" };
  }
  return { kind: "not-found" };
}

// ---------------------------------------------------------------- entry

/**
 * §4.5, first hit wins. `configuredPath` is the raw `constly.path` setting: when
 * set it is the only candidate — a wrong explicit path is reported, not
 * silently replaced by detection.
 */
export async function detectConstly(configuredPath: string, deps: ProbeDeps): Promise<Detection> {
  const configured = configuredPath.trim();
  if (configured !== "") {
    const target = classifyPath(configured, deps);
    return target ? { kind: "found", target, source: "setting" } : { kind: "invalid-path", path: configured };
  }
  switch (deps.platform) {
    case "darwin":
      return detectMac(deps);
    case "win32":
      return detectWindows(deps);
    default:
      return detectLinux(deps);
  }
}

/**
 * Session cache for a POSITIVE result only (§4.5). Keyed by the `constly.path`
 * value it was found under, so changing the setting is never served a stale
 * target. A negative result is never cached: a user who installs Constly after
 * seeing the funnel must not stay "not installed" until reload.
 */
export class DetectionCache {
  private entry: { configuredPath: string; target: Target } | undefined;

  get(configuredPath: string): Target | undefined {
    return this.entry && this.entry.configuredPath === configuredPath ? this.entry.target : undefined;
  }

  set(configuredPath: string, target: Target): void {
    this.entry = { configuredPath, target };
  }

  clear(): void {
    this.entry = undefined;
  }
}
