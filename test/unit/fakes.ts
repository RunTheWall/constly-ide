// Fakes for the injected side-effect surface: a virtual filesystem of typed
// entries and a scripted process runner that records every probe.
import type { LaunchDeps, ProbeDeps, RunResult, SpawnedProcess, SpawnOptions } from "../../src/platform";

export type Entry = "exe" | "file" | "dir";

export interface RecordedRun {
  file: string;
  args: string[];
}

export type RunScript = (file: string, args: readonly string[]) => RunResult | undefined;

export interface FakeProbeDeps extends ProbeDeps {
  runs: RecordedRun[];
}

export const ok = (stdout = ""): RunResult => ({ status: 0, stdout, stderr: "", timedOut: false });
export const fail = (status = 1, stderr = ""): RunResult => ({ status, stdout: "", stderr, timedOut: false });
export const enoent = (): RunResult => ({
  status: null,
  stdout: "",
  stderr: "",
  error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
  timedOut: false,
});
export const timedOut = (): RunResult => ({
  status: null,
  stdout: "",
  stderr: "",
  error: Object.assign(new Error("killed"), { killed: true, signal: "SIGTERM" }),
  timedOut: true,
});

export function fakeProbeDeps(options: {
  platform: NodeJS.Platform;
  homedir?: string;
  env?: Record<string, string | undefined>;
  files?: Record<string, Entry>;
  run?: RunScript;
}): FakeProbeDeps {
  const files = options.files ?? {};
  const runs: RecordedRun[] = [];
  const kindOf = (p: string): Entry | undefined => files[p];
  return {
    runs,
    platform: options.platform,
    homedir: () => options.homedir ?? (options.platform === "win32" ? "C:\\Users\\ada" : "/Users/ada"),
    env: options.env ?? {},
    exists: (p) => kindOf(p) !== undefined,
    isDirectory: (p) => kindOf(p) === "dir",
    isExecutableFile: (p) => kindOf(p) === "exe",
    run: async (file, args) => {
      runs.push({ file, args: [...args] });
      return options.run?.(file, args) ?? enoent();
    },
  };
}

export class FakeChild implements SpawnedProcess {
  unrefCalls = 0;
  private listeners: Record<string, ((...a: never[]) => void)[]> = {};
  unref(): void {
    this.unrefCalls += 1;
  }
  once(event: "spawn", listener: () => void): this;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  once(event: "error", listener: (err: Error) => void): this;
  once(event: string, listener: (...a: never[]) => void): this {
    (this.listeners[event] ??= []).push(listener);
    return this;
  }
  emit(event: string, ...args: unknown[]): void {
    const ls = this.listeners[event] ?? [];
    this.listeners[event] = [];
    for (const l of ls) (l as (...a: unknown[]) => void)(...args);
  }
}

export interface RecordedSpawn {
  file: string;
  args: string[];
  options: SpawnOptions;
  child: FakeChild;
}

export interface FakeLaunchDeps extends LaunchDeps {
  spawns: RecordedSpawn[];
  runs: RecordedRun[];
  /** The delay of every timer started. */
  timers: number[];
  /** How many timers were cancelled before firing. */
  cancelled: number;
  /** Fire every pending timer. */
  wake(): void;
}

export function fakeLaunchDeps(options: {
  platform: NodeJS.Platform;
  homedir?: string;
  env?: Record<string, string | undefined>;
  run?: RunScript;
  /** Called synchronously right after each spawn so a test can script the child. */
  onSpawn?: (spawn: RecordedSpawn) => void;
  spawnThrows?: Error;
}): FakeLaunchDeps {
  const spawns: RecordedSpawn[] = [];
  const runs: RecordedRun[] = [];
  const timers: number[] = [];
  let pending: { callback: () => void; live: boolean }[] = [];
  const deps: FakeLaunchDeps = {
    spawns,
    runs,
    timers,
    cancelled: 0,
    wake: () => {
      const due = pending;
      pending = [];
      for (const t of due) {
        if (!t.live) continue;
        // A fired timer is no longer cancellable (clearTimeout after firing is a no-op).
        t.live = false;
        t.callback();
      }
    },
    platform: options.platform,
    homedir: () => options.homedir ?? "/Users/ada",
    env: options.env ?? {},
    spawn: (file, args, spawnOptions) => {
      if (options.spawnThrows) throw options.spawnThrows;
      const child = new FakeChild();
      const rec = { file, args: [...args], options: spawnOptions, child };
      spawns.push(rec);
      // A real ChildProcess emits `spawn`/`error` on a later tick, after the
      // caller has attached its listeners; the script runs the same way.
      if (options.onSpawn) queueMicrotask(() => options.onSpawn?.(rec));
      return child;
    },
    run: async (file, args) => {
      runs.push({ file, args: [...args] });
      return options.run?.(file, args) ?? enoent();
    },
    setTimer: (ms, callback) => {
      timers.push(ms);
      const entry = { callback, live: true };
      pending.push(entry);
      return () => {
        if (!entry.live) return;
        entry.live = false;
        deps.cancelled += 1;
      };
    },
  };
  return deps;
}

/** Let queued microtasks run. */
export const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
