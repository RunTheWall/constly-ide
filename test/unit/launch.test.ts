import { describe, expect, it } from "vitest";
import type { Target } from "../../src/detect";
import {
  LAUNCH_SETTLE_MS,
  commandFor,
  createLauncher,
  escapeRegex,
  isInstanceRunning,
  launchOnce,
  macOpenArgs,
  pgrepPattern,
} from "../../src/launch";
import { enoent, fail, fakeLaunchDeps, ok, tick, timedOut } from "./fakes";

const APP = "/Applications/Constly.app";
const EXE = "/Applications/Constly.app/Contents/MacOS/constly";
const bundle: Target = { kind: "bundle", app: APP, exe: EXE };
const bare: Target = { kind: "binary", exe: "/Users/ada/dev/target/release/constly", degraded: true };
const linuxBin: Target = { kind: "binary", exe: "/usr/bin/constly", degraded: false };
const flatpakBin: Target = { kind: "binary", exe: "/usr/bin/constly", degraded: false, wrapper: ["flatpak-spawn", "--host"] };
const ARGV = ["--goto=3:1", "--from=vscode", "--", "/abs/a.md"];

describe("pgrep pattern", () => {
  it("is the inner-binary path, regex-escaped and ^-anchored", () => {
    expect(pgrepPattern(EXE)).toBe("^/Applications/Constly\\.app/Contents/MacOS/constly");
    expect(escapeRegex("a+b (c) [d] {e} ^$ | ? * \\ .")).toBe("a\\+b \\(c\\) \\[d\\] \\{e\\} \\^\\$ \\| \\? \\* \\\\ \\.");
  });

  it("maps exit 0 → running, 1 → not, anything else (2, 3, ENOENT, timeout) → not running", async () => {
    const check = async (result: ReturnType<typeof ok>) => {
      const deps = fakeLaunchDeps({ platform: "darwin", run: () => result });
      const running = await isInstanceRunning(EXE, deps);
      expect(deps.runs).toEqual([{ file: "pgrep", args: ["-f", pgrepPattern(EXE)] }]);
      return running;
    };
    expect(await check(ok("42933\n"))).toBe(true);
    expect(await check(fail(1))).toBe(false);
    expect(await check(fail(2))).toBe(false);
    expect(await check(fail(3))).toBe(false);
    expect(await check(enoent())).toBe(false);
    expect(await check(timedOut())).toBe(false);
  });
});

describe("commandFor — the verb table", () => {
  it("macOS, bundle, NOT running: open -a <app> <path> --args <argv> — the file goes both as a document and as argv", () => {
    const c = commandFor({ target: bundle, path: "/abs/a.md", argv: ARGV }, "darwin", false);
    expect(c).toEqual({
      file: "open",
      args: ["-a", APP, "/abs/a.md", "--args", "--goto=3:1", "--from=vscode", "--", "/abs/a.md"],
      macVerb: "open",
    });
    expect(macOpenArgs(APP, "/abs/a.md", ARGV).filter((a) => a === "/abs/a.md")).toHaveLength(2);
    expect(c.args).not.toContain("-b");
  });

  it("macOS, bundle, running: exec the inner binary with the same argv (it forwards and exits)", () => {
    expect(commandFor({ target: bundle, path: "/abs/a.md", argv: ARGV }, "darwin", true)).toEqual({
      file: EXE,
      args: ARGV,
      macVerb: "exec",
    });
  });

  it("macOS, degraded bare binary: exec in both cases", () => {
    for (const running of [false, true]) {
      expect(commandFor({ target: bare, path: "/abs/a.md", argv: ARGV }, "darwin", running)).toEqual({
        file: bare.exe,
        args: ARGV,
      });
    }
  });

  it("Windows / Linux: spawn the executable with argv", () => {
    expect(commandFor({ target: linuxBin, path: "/abs/a.md", argv: ARGV }, "linux", false)).toEqual({
      file: "/usr/bin/constly",
      args: ARGV,
    });
    const win: Target = { kind: "binary", exe: "C:\\Users\\ada\\AppData\\Local\\Constly\\constly.exe", degraded: false };
    expect(commandFor({ target: win, path: "C:\\w\\a.md", argv: ["--", "C:\\w\\a.md"] }, "win32", false)).toEqual({
      file: win.exe,
      args: ["--", "C:\\w\\a.md"],
    });
  });

  it("Flatpak: flatpak-spawn --host <exe> <argv>", () => {
    expect(commandFor({ target: flatpakBin, path: "/abs/a.md", argv: ARGV }, "linux", false)).toEqual({
      file: "flatpak-spawn",
      args: ["--host", "/usr/bin/constly", ...ARGV],
    });
  });

  it("argv is passed through untouched: the literal -- stays a separate token", () => {
    const c = commandFor({ target: linuxBin, path: "/abs/a.md", argv: ARGV }, "linux", false);
    expect(c.args.indexOf("--")).toBe(2);
    expect(c.args[c.args.length - 1]).toBe("/abs/a.md");
  });
});

describe("launchOnce — spawn discipline", () => {
  it("runs the pgrep check only for a macOS bundle, and picks open vs exec from its answer", async () => {
    const cold = fakeLaunchDeps({ platform: "darwin", run: () => fail(1), onSpawn: (s) => s.child.emit("spawn") });
    const p = launchOnce({ target: bundle, path: "/abs/a.md", argv: ARGV }, cold);
    await tick();
    cold.wake();
    expect((await p).macVerb).toBe("open");
    expect(cold.runs).toEqual([{ file: "pgrep", args: ["-f", pgrepPattern(EXE)] }]);
    expect(cold.spawns[0].file).toBe("open");

    const warm = fakeLaunchDeps({ platform: "darwin", run: () => ok("1\n"), onSpawn: (s) => s.child.emit("spawn") });
    const q = launchOnce({ target: bundle, path: "/abs/a.md", argv: ARGV }, warm);
    await tick();
    warm.wake();
    expect((await q).macVerb).toBe("exec");
    expect(warm.spawns[0].file).toBe(EXE);

    const degraded = fakeLaunchDeps({ platform: "darwin", run: () => ok("1\n"), onSpawn: (s) => s.child.emit("spawn") });
    const r = launchOnce({ target: bare, path: "/abs/a.md", argv: ARGV }, degraded);
    await tick();
    degraded.wake();
    await r;
    expect(degraded.runs).toEqual([]);

    const linux = fakeLaunchDeps({ platform: "linux", onSpawn: (s) => s.child.emit("spawn") });
    const s = launchOnce({ target: linuxBin, path: "/abs/a.md", argv: ARGV }, linux);
    await tick();
    linux.wake();
    await s;
    expect(linux.runs).toEqual([]);
  });

  it("spawns detached with a sanitised environment and cwd = home, and unrefs the child", async () => {
    const deps = fakeLaunchDeps({
      platform: "linux",
      homedir: "/home/ada",
      env: { PATH: "/usr/bin", VSCODE_PID: "1", ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: "x", GTK_PATH: "/snap", HOME: "/home/ada" },
      onSpawn: (s) => s.child.emit("spawn"),
    });
    const p = launchOnce({ target: linuxBin, path: "/abs/a.md", argv: ARGV }, deps);
    await tick();
    deps.wake();
    await p;
    const [spawn] = deps.spawns;
    expect(spawn.options.cwd).toBe("/home/ada");
    expect(spawn.options.env).toEqual({ PATH: "/usr/bin", HOME: "/home/ada" });
    expect(spawn.child.unrefCalls).toBe(1);
  });

  it("returns when the child exits, or after the 1.5 s settle window if it does not", async () => {
    const exits = fakeLaunchDeps({ platform: "linux", onSpawn: (s) => s.child.emit("spawn") });
    let done = false;
    const p = launchOnce({ target: linuxBin, path: "/abs/a.md", argv: ARGV }, exits).then(() => {
      done = true;
    });
    await tick();
    expect(done).toBe(false);
    exits.spawns[0].child.emit("exit", 0, null);
    await p;
    expect(done).toBe(true);
    expect(exits.sleeps).toEqual([LAUNCH_SETTLE_MS]);

    const lingers = fakeLaunchDeps({ platform: "linux", onSpawn: (s) => s.child.emit("spawn") });
    let settled = false;
    const q = launchOnce({ target: linuxBin, path: "/abs/a.md", argv: ARGV }, lingers).then(() => {
      settled = true;
    });
    await tick();
    expect(settled).toBe(false);
    lingers.wake();
    await q;
    expect(settled).toBe(true);
  });

  it("rejects when the process cannot be started (error event or a synchronous throw)", async () => {
    const errors = fakeLaunchDeps({
      platform: "linux",
      onSpawn: (s) => s.child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })),
    });
    await expect(launchOnce({ target: linuxBin, path: "/abs/a.md", argv: ARGV }, errors)).rejects.toThrow("ENOENT");

    const throws = fakeLaunchDeps({ platform: "linux", spawnThrows: new Error("EACCES") });
    await expect(launchOnce({ target: linuxBin, path: "/abs/a.md", argv: ARGV }, throws)).rejects.toThrow("EACCES");
  });
});

describe("one launch per path, sequentially", () => {
  it("the next spawn does not start until the previous launch has exited or settled", async () => {
    const deps = fakeLaunchDeps({ platform: "linux", onSpawn: (s) => s.child.emit("spawn") });
    const launch = createLauncher(deps);
    const paths = ["/abs/a.md", "/abs/b.md", "/abs/c.md"];
    const order: string[] = [];
    const run = (async () => {
      for (const path of paths) {
        await launch({ target: linuxBin, path, argv: ["--from=vscode", "--", path] });
        order.push(path);
      }
    })();
    await tick();
    expect(deps.spawns.map((s) => s.args[2])).toEqual(["/abs/a.md"]);
    deps.spawns[0].child.emit("exit", 0, null);
    await tick();
    expect(deps.spawns.map((s) => s.args[2])).toEqual(["/abs/a.md", "/abs/b.md"]);
    deps.wake(); // b lingers → settle window elapses
    await tick();
    expect(deps.spawns.map((s) => s.args[2])).toEqual(["/abs/a.md", "/abs/b.md", "/abs/c.md"]);
    deps.spawns[2].child.emit("exit", 0, null);
    await run;
    expect(order).toEqual(paths);
  });
});
