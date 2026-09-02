// The side-effect surface — everything that touches the filesystem or starts a
// process goes through one of these two interfaces, so detection and launch
// can be unit-tested with fakes and so the activation test can spy on the real
// module functions (`fs.*`, `child_process.*`) that the Node implementations
// call. Nothing in this file runs at import time.
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";

/** Every probe (mdfind, reg query, which, where, pgrep, flatpak-spawn) gets this long. */
export const PROBE_TIMEOUT_MS = 2000;

export interface RunResult {
  /** Exit code, or null when the process did not exit normally (signal, timeout, spawn failure). */
  status: number | null;
  stdout: string;
  stderr: string;
  /** Set when the process could not be started or was killed (incl. timeout). */
  error?: Error;
  timedOut: boolean;
}

/** What detection needs to know about the machine. */
export interface ProbeDeps {
  platform: NodeJS.Platform;
  homedir(): string;
  env: Readonly<Record<string, string | undefined>>;
  exists(path: string): boolean;
  isDirectory(path: string): boolean;
  /** A regular file the current user may execute (on Windows: a regular file). */
  isExecutableFile(path: string): boolean;
  /** Run `file` with an args array — never a shell — under the probe timeout. */
  run(file: string, args: readonly string[]): Promise<RunResult>;
}

/** The subset of ChildProcess the launcher relies on. */
export interface SpawnedProcess {
  unref(): void;
  once(event: "spawn", listener: () => void): this;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  once(event: "error", listener: (err: Error) => void): this;
}

export interface SpawnOptions {
  env: Record<string, string>;
  cwd: string;
}

/** What launching needs. */
export interface LaunchDeps {
  platform: NodeJS.Platform;
  homedir(): string;
  env: Readonly<Record<string, string | undefined>>;
  /** Detached, stdio ignored, no shell. */
  spawn(file: string, args: readonly string[], options: SpawnOptions): SpawnedProcess;
  /** For `pgrep`: same contract as ProbeDeps.run. */
  run(file: string, args: readonly string[]): Promise<RunResult>;
  sleep(ms: number): Promise<void>;
}

function runWithExecFile(file: string, args: readonly string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    cp.execFile(
      file,
      [...args],
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true, encoding: "utf8", maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ status: 0, stdout, stderr, timedOut: false });
          return;
        }
        const err = error as cp.ExecFileException;
        resolve({
          status: typeof err.code === "number" ? err.code : null,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          error: err,
          timedOut: err.killed === true,
        });
      },
    );
  });
}

function statOrUndefined(path: string): fs.Stats | undefined {
  try {
    return fs.statSync(path);
  } catch {
    return undefined;
  }
}

/** The real thing. Construction is free of side effects; every method probes lazily. */
export function nodeProbeDeps(): ProbeDeps {
  return {
    platform: process.platform,
    homedir: () => os.homedir(),
    env: process.env,
    exists: (path) => fs.existsSync(path),
    isDirectory: (path) => statOrUndefined(path)?.isDirectory() === true,
    isExecutableFile: (path) => {
      const st = statOrUndefined(path);
      if (!st?.isFile()) return false;
      if (process.platform === "win32") return true;
      try {
        fs.accessSync(path, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    run: runWithExecFile,
  };
}

export function nodeLaunchDeps(): LaunchDeps {
  return {
    platform: process.platform,
    homedir: () => os.homedir(),
    env: process.env,
    spawn: (file, args, options) =>
      cp.spawn(file, [...args], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: options.env,
        cwd: options.cwd,
      }),
    run: runWithExecFile,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}
