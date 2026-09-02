import { describe, expect, it } from "vitest";
import {
  DetectionCache,
  FLATPAK_HOST_WRAPPER,
  classifyPath,
  detectConstly,
  expandHome,
  expandPath,
  expandWindowsEnv,
  innerBinaryOf,
  parseRegQuery,
  stripQuotes,
} from "../../src/detect";
import { enoent, fail, fakeProbeDeps, ok, timedOut } from "./fakes";

const MAC_APP = "/Applications/Constly.app";
const MAC_EXE = "/Applications/Constly.app/Contents/MacOS/constly";
const USER_APP = "/Users/ada/Applications/Constly.app";
const USER_EXE = "/Users/ada/Applications/Constly.app/Contents/MacOS/constly";
const MDFIND_ARGS = [
  "-onlyin",
  "/Applications",
  "-onlyin",
  "/Users/ada/Applications",
  "kMDItemCFBundleIdentifier == 'com.constly.app'",
];

describe("path expansion (no shell anywhere, so ~ and %VAR% are ours to expand)", () => {
  it("expands a leading ~ only", () => {
    expect(expandHome("~", "/Users/ada")).toBe("/Users/ada");
    expect(expandHome("~/Applications/Constly.app", "/Users/ada")).toBe("/Users/ada/Applications/Constly.app");
    expect(expandHome("~bob/x", "/Users/ada")).toBe("~bob/x");
    expect(expandHome("/opt/~/x", "/Users/ada")).toBe("/opt/~/x");
  });

  it("expands %LOCALAPPDATA% case-insensitively and leaves unknown variables alone", () => {
    const env = { LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local" };
    expect(expandWindowsEnv("%LOCALAPPDATA%\\Constly\\constly.exe", env)).toBe(
      "C:\\Users\\ada\\AppData\\Local\\Constly\\constly.exe",
    );
    expect(expandWindowsEnv("%localappdata%\\Constly", env)).toBe("C:\\Users\\ada\\AppData\\Local\\Constly");
    expect(expandWindowsEnv("%NOPE%\\x", env)).toBe("%NOPE%\\x");
  });

  it("expandPath: ~ on every platform, %VAR% on Windows only (a POSIX file name may contain %)", () => {
    const env = { LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local" };
    const win = { platform: "win32" as const, homedir: () => "C:\\Users\\ada", env };
    expect(expandPath("%LOCALAPPDATA%\\Constly\\constly.exe", win)).toBe("C:\\Users\\ada\\AppData\\Local\\Constly\\constly.exe");
    expect(expandPath("~\\Constly.app", win)).toBe("C:\\Users\\ada\\Constly.app");
    for (const platform of ["darwin", "linux"] as const) {
      const posix = { platform, homedir: () => "/Users/ada", env };
      expect(expandPath("/opt/%LOCALAPPDATA%/constly", posix)).toBe("/opt/%LOCALAPPDATA%/constly");
      expect(expandPath("~/Applications/Constly.app", posix)).toBe("/Users/ada/Applications/Constly.app");
      expect(expandPath("  ~/x  ", posix)).toBe("/Users/ada/x");
    }
  });

  it("maps a bundle to its inner binary", () => {
    expect(innerBinaryOf(MAC_APP)).toBe(MAC_EXE);
  });
});

describe("classifyPath — the §4.5 'all' row", () => {
  it(".app bundle → target is the bundle, executable is Contents/MacOS/constly", () => {
    const deps = fakeProbeDeps({ platform: "darwin", files: { [MAC_APP]: "dir", [MAC_EXE]: "exe" } });
    expect(classifyPath(MAC_APP, deps)).toEqual({ kind: "bundle", app: MAC_APP, exe: MAC_EXE });
    expect(classifyPath(MAC_APP + "/", deps)).toEqual({ kind: "bundle", app: MAC_APP, exe: MAC_EXE });
  });

  it("a .app without an executable inner binary is not a target", () => {
    const deps = fakeProbeDeps({ platform: "darwin", files: { [MAC_APP]: "dir" } });
    expect(classifyPath(MAC_APP, deps)).toBeUndefined();
  });

  it("a bare binary on macOS is a DEGRADED target; elsewhere a normal one", () => {
    const mac = fakeProbeDeps({ platform: "darwin", files: { "/Users/ada/dev/target/release/constly": "exe" } });
    expect(classifyPath("/Users/ada/dev/target/release/constly", mac)).toEqual({
      kind: "binary",
      exe: "/Users/ada/dev/target/release/constly",
      degraded: true,
    });
    const linux = fakeProbeDeps({ platform: "linux", files: { "/usr/local/bin/constly": "exe" } });
    expect(classifyPath("/usr/local/bin/constly", linux)).toEqual({
      kind: "binary",
      exe: "/usr/local/bin/constly",
      degraded: false,
    });
  });

  it("a plain file, a non-bundle directory, or nothing at all is not a target (spawning a directory fails with EACCES)", () => {
    const deps = fakeProbeDeps({ platform: "linux", files: { "/opt/constly": "dir", "/tmp/notes.md": "file" } });
    expect(classifyPath("/opt/constly", deps)).toBeUndefined();
    expect(classifyPath("/tmp/notes.md", deps)).toBeUndefined();
    expect(classifyPath("/nope", deps)).toBeUndefined();
    expect(classifyPath("", deps)).toBeUndefined();
  });

  it("expands ~ and %LOCALAPPDATA% in constly.path", () => {
    const mac = fakeProbeDeps({ platform: "darwin", files: { [USER_APP]: "dir", [USER_EXE]: "exe" } });
    expect(classifyPath("~/Applications/Constly.app", mac)).toEqual({ kind: "bundle", app: USER_APP, exe: USER_EXE });
    const exe = "C:\\Users\\ada\\AppData\\Local\\Constly\\constly.exe";
    const win = fakeProbeDeps({
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local" },
      files: { [exe]: "exe" },
    });
    expect(classifyPath("%LOCALAPPDATA%\\Constly\\constly.exe", win)).toEqual({ kind: "binary", exe, degraded: false });
  });
});

describe("detectConstly — constly.path set", () => {
  it("a valid explicit path wins without probing", async () => {
    const deps = fakeProbeDeps({ platform: "darwin", files: { [MAC_APP]: "dir", [MAC_EXE]: "exe" } });
    expect(await detectConstly(MAC_APP, deps)).toEqual({
      kind: "found",
      target: { kind: "bundle", app: MAC_APP, exe: MAC_EXE },
      source: "setting",
    });
    expect(deps.runs).toEqual([]);
  });

  it("an invalid explicit path is reported (Locate…), never silently replaced by detection", async () => {
    const deps = fakeProbeDeps({ platform: "darwin", files: { [MAC_APP]: "dir", [MAC_EXE]: "exe" } });
    expect(await detectConstly("/Users/ada/Downloads/Constly.app", deps)).toEqual({
      kind: "invalid-path",
      path: "/Users/ada/Downloads/Constly.app",
    });
    expect(deps.runs).toEqual([]);
  });
});

describe("detectConstly — macOS", () => {
  it("/Applications/Constly.app first", async () => {
    const deps = fakeProbeDeps({
      platform: "darwin",
      files: { [MAC_APP]: "dir", [MAC_EXE]: "exe", [USER_APP]: "dir", [USER_EXE]: "exe" },
    });
    const d = await detectConstly("", deps);
    expect(d).toEqual({ kind: "found", target: { kind: "bundle", app: MAC_APP, exe: MAC_EXE }, source: "applications" });
    expect(deps.runs).toEqual([]);
  });

  it("then ~/Applications/Constly.app (homedir expanded in code)", async () => {
    const deps = fakeProbeDeps({ platform: "darwin", files: { [USER_APP]: "dir", [USER_EXE]: "exe" } });
    expect(await detectConstly("", deps)).toMatchObject({ source: "user-applications", target: { exe: USER_EXE } });
    expect(deps.runs).toEqual([]);
  });

  it("then a SCOPED mdfind by bundle id, taking the first hit with an executable inner binary", async () => {
    const found = "/Applications/Utilities/Constly.app";
    const deps = fakeProbeDeps({
      platform: "darwin",
      files: { [found]: "dir", [innerBinaryOf(found)]: "exe" },
      run: (file) => (file === "mdfind" ? ok(`/Applications/Stale/Constly.app\n${found}\n`) : undefined),
    });
    const d = await detectConstly("", deps);
    expect(d).toEqual({
      kind: "found",
      target: { kind: "bundle", app: found, exe: innerBinaryOf(found) },
      source: "mdfind",
    });
    expect(deps.runs).toEqual([{ file: "mdfind", args: MDFIND_ARGS }]);
  });

  it("an mdfind timeout (Spotlight reindex) or failure is a plain not-found", async () => {
    for (const result of [timedOut(), fail(1), enoent()]) {
      const deps = fakeProbeDeps({ platform: "darwin", run: () => result });
      expect(await detectConstly("", deps)).toEqual({ kind: "not-found" });
    }
  });
});

describe("detectConstly — Windows", () => {
  const env = { SystemRoot: "C:\\Windows", LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local" };
  const REG = "C:\\Windows\\System32\\reg.exe";
  const WHERE = "C:\\Windows\\System32\\where.exe";
  const HKCU = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Constly";
  const HKLM = "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Constly";
  const regOutput = (location: string, binary?: string, type = "REG_SZ") =>
    [
      "",
      "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Constly",
      "    DisplayName    REG_SZ    Constly",
      "    DisplayVersion    REG_SZ    4.7.0",
      `    InstallLocation    ${type}    ${location}`,
      ...(binary ? [`    MainBinaryName    REG_SZ    ${binary}`] : []),
      "    UninstallString    REG_SZ    \"C:\\Users\\ada\\AppData\\Local\\Constly\\uninstall.exe\"",
      "",
    ].join("\r\n");

  it("parses reg query output and strips the literal quotes NSIS writes around InstallLocation", () => {
    const values = parseRegQuery(regOutput('"C:\\Users\\ada\\AppData\\Local\\Constly"', "constly.exe"));
    expect(values.InstallLocation).toBe('"C:\\Users\\ada\\AppData\\Local\\Constly"');
    expect(stripQuotes(values.InstallLocation)).toBe("C:\\Users\\ada\\AppData\\Local\\Constly");
    expect(values.MainBinaryName).toBe("constly.exe");
    expect(stripQuotes("plain")).toBe("plain");
    expect(stripQuotes('"')).toBe('"');
  });

  it("HKCU Uninstall\\Constly → InstallLocation (quotes stripped) + MainBinaryName", async () => {
    const exe = "C:\\Users\\ada\\AppData\\Local\\Constly\\constly.exe";
    const deps = fakeProbeDeps({
      platform: "win32",
      env,
      files: { [exe]: "exe" },
      run: (file, args) =>
        file === REG && args[1] === HKCU ? ok(regOutput('"C:\\Users\\ada\\AppData\\Local\\Constly"', "constly.exe")) : undefined,
    });
    expect(await detectConstly("", deps)).toEqual({
      kind: "found",
      target: { kind: "binary", exe, degraded: false },
      source: "registry-hkcu",
    });
    expect(deps.runs).toEqual([{ file: REG, args: ["query", HKCU] }]);
  });

  it("a REG_EXPAND_SZ InstallLocation is expanded after its quotes are stripped", async () => {
    const exe = "C:\\Users\\ada\\AppData\\Local\\Constly\\constly.exe";
    const deps = fakeProbeDeps({
      platform: "win32",
      env,
      files: { [exe]: "exe" },
      run: (file, args) =>
        file === REG && args[1] === HKCU ? ok(regOutput('"%LOCALAPPDATA%\\Constly"', "constly.exe", "REG_EXPAND_SZ")) : undefined,
    });
    expect(await detectConstly("", deps)).toEqual({
      kind: "found",
      target: { kind: "binary", exe, degraded: false },
      source: "registry-hkcu",
    });
  });

  it("then HKLM (per-machine installs); MainBinaryName defaults to constly.exe", async () => {
    const exe = "C:\\Program Files\\Constly\\constly.exe";
    const deps = fakeProbeDeps({
      platform: "win32",
      env,
      files: { [exe]: "exe" },
      run: (file, args) => {
        if (file !== REG) return undefined;
        if (args[1] === HKCU) return fail(1, "ERROR: The system was unable to find the specified registry key or value.");
        if (args[1] === HKLM) return ok(regOutput('"C:\\Program Files\\Constly"'));
        return undefined;
      },
    });
    expect(await detectConstly("", deps)).toMatchObject({ source: "registry-hklm", target: { exe } });
    expect(deps.runs.map((r) => r.args[1])).toEqual([HKCU, HKLM]);
  });

  it("then %LOCALAPPDATA%\\Constly\\constly.exe, expanded from the environment", async () => {
    const exe = "C:\\Users\\ada\\AppData\\Local\\Constly\\constly.exe";
    const deps = fakeProbeDeps({ platform: "win32", env, files: { [exe]: "exe" }, run: () => fail(1) });
    expect(await detectConstly("", deps)).toMatchObject({ source: "localappdata", target: { exe } });
  });

  it("then `where constly` (first line), and not-found after that", async () => {
    const exe = "D:\\tools\\constly.exe";
    const deps = fakeProbeDeps({
      platform: "win32",
      env,
      files: { [exe]: "exe" },
      run: (file, args) => (file === WHERE && args[0] === "constly.exe" ? ok(`${exe}\r\nD:\\other\\constly.exe\r\n`) : fail(1)),
    });
    expect(await detectConstly("", deps)).toMatchObject({ source: "where", target: { exe } });

    const none = fakeProbeDeps({ platform: "win32", env, run: () => fail(1) });
    expect(await detectConstly("", none)).toEqual({ kind: "not-found" });
    expect(none.runs.map((r) => r.file)).toEqual([REG, REG, WHERE]);
    expect(none.runs[2].args).toEqual(["constly.exe"]);
  });

  it("a registry probe that times out falls through to the next step", async () => {
    const exe = "C:\\Users\\ada\\AppData\\Local\\Constly\\constly.exe";
    const deps = fakeProbeDeps({ platform: "win32", env, files: { [exe]: "exe" }, run: () => timedOut() });
    expect(await detectConstly("", deps)).toMatchObject({ source: "localappdata" });
  });
});

describe("detectConstly — Linux", () => {
  it("`which constly` first, then /usr/bin/constly, then not-found", async () => {
    const which = fakeProbeDeps({
      platform: "linux",
      files: { "/usr/local/bin/constly": "exe" },
      run: (file) => (file === "which" ? ok("/usr/local/bin/constly\n") : undefined),
    });
    expect(await detectConstly("", which)).toMatchObject({ source: "which", target: { exe: "/usr/local/bin/constly" } });
    expect(which.runs).toEqual([{ file: "which", args: ["constly"] }]);

    const usrBin = fakeProbeDeps({ platform: "linux", files: { "/usr/bin/constly": "exe" }, run: () => enoent() });
    expect(await detectConstly("", usrBin)).toMatchObject({ source: "usr-bin", target: { exe: "/usr/bin/constly" } });

    const none = fakeProbeDeps({ platform: "linux", run: () => fail(1) });
    expect(await detectConstly("", none)).toEqual({ kind: "not-found" });
  });

  describe("Flatpak-sandboxed IDE (/.flatpak-info present)", () => {
    it("reports unreachable when flatpak-spawn --host cannot run anything", async () => {
      const deps = fakeProbeDeps({ platform: "linux", files: { "/.flatpak-info": "file" }, run: () => fail(1) });
      expect(await detectConstly("", deps)).toEqual({ kind: "flatpak-unreachable" });
      expect(deps.runs).toEqual([{ file: "flatpak-spawn", args: ["--host", "true"] }]);
      const missing = fakeProbeDeps({ platform: "linux", files: { "/.flatpak-info": "file" }, run: () => enoent() });
      expect(await detectConstly("", missing)).toEqual({ kind: "flatpak-unreachable" });
    });

    it("probes and launches through flatpak-spawn --host: which, then test -x /usr/bin/constly", async () => {
      const viaWhich = fakeProbeDeps({
        platform: "linux",
        files: { "/.flatpak-info": "file" },
        run: (_file, args) => (args[1] === "true" || args[1] === "which" ? ok("/usr/bin/constly\n") : fail(1)),
      });
      expect(await detectConstly("", viaWhich)).toEqual({
        kind: "found",
        target: { kind: "binary", exe: "/usr/bin/constly", degraded: false, wrapper: FLATPAK_HOST_WRAPPER },
        source: "flatpak-which",
      });
      expect(viaWhich.runs.map((r) => r.args)).toEqual([
        ["--host", "true"],
        ["--host", "which", "constly"],
      ]);

      const viaTest = fakeProbeDeps({
        platform: "linux",
        files: { "/.flatpak-info": "file" },
        run: (_file, args) => (args[1] === "true" || args[1] === "test" ? ok() : fail(1)),
      });
      expect(await detectConstly("", viaTest)).toMatchObject({ source: "flatpak-usr-bin", target: { wrapper: FLATPAK_HOST_WRAPPER } });
      expect(viaTest.runs[2]).toEqual({ file: "flatpak-spawn", args: ["--host", "test", "-x", "/usr/bin/constly"] });

      const none = fakeProbeDeps({
        platform: "linux",
        files: { "/.flatpak-info": "file" },
        run: (_file, args) => (args[1] === "true" ? ok() : fail(1)),
      });
      expect(await detectConstly("", none)).toEqual({ kind: "not-found" });
    });
  });
});

describe("DetectionCache — positive results only, keyed by the constly.path they were found under", () => {
  it("serves the target for the same setting and forgets it when the setting changes or on clear()", () => {
    const cache = new DetectionCache();
    const target = { kind: "bundle", app: MAC_APP, exe: MAC_EXE } as const;
    expect(cache.get("")).toBeUndefined();
    cache.set("", target);
    expect(cache.get("")).toBe(target);
    expect(cache.get("/somewhere/else.app")).toBeUndefined();
    cache.clear();
    expect(cache.get("")).toBeUndefined();
  });
});
