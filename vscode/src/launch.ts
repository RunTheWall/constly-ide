// Launch — design §4.6. Always an args array, never a shell, never `cmd /c
// start`; one launch per path, in order, each waiting for the previous
// process to exit or LAUNCH_SETTLE_MS (a Constly secondary exits as soon as it
// has forwarded through the single-instance socket).
import type { Target } from "./detect";
import { sanitisedEnv } from "./env";
import type { LaunchDeps, SpawnedProcess } from "./platform";

/** How long one launch may take before the next path is handed over. */
export const LAUNCH_SETTLE_MS = 1500;

export interface LaunchInvocation {
  target: Target;
  path: string;
  /** The contract argv for this path: `[--goto=L:C?, --from=id?, "--", path]`. */
  argv: readonly string[];
}

/** Rejects when the process could not be started (ENOENT, EACCES, …). */
export type LaunchFn = (invocation: LaunchInvocation) => Promise<void>;

/** Which command line a launch turned into — returned for tests and logs. */
export interface LaunchCommand {
  file: string;
  args: string[];
  /** macOS only: how the running-instance check went. */
  macVerb?: "open" | "exec";
}

/** Escape for an extended regular expression (what `pgrep -f` compiles). `/` is not special there and stays bare. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `pgrep -f` pattern: the inner-binary path, regex-escaped and anchored at the start of the command line. */
export function pgrepPattern(exe: string): string {
  return "^" + escapeRegex(exe);
}

/**
 * exit 0 = running, 1 = not running, anything else (2 syntax error, 3 fatal,
 * a spawn failure, a timeout) = treat as not running. A false "not running"
 * degrades to `open -a`, which still delivers the document (caret lost).
 */
export async function isInstanceRunning(exe: string, deps: Pick<LaunchDeps, "run">): Promise<boolean> {
  const r = await deps.run("pgrep", ["-f", pgrepPattern(exe)]);
  return r.status === 0;
}

/** `open -a <app> <path> --args <argv...>` — the file goes as a LaunchServices document AND as argv; Constly de-duplicates. */
export function macOpenArgs(app: string, path: string, argv: readonly string[]): string[] {
  return ["-a", app, path, "--args", ...argv];
}

/** Decide the command line for one launch (pure, given the running check's answer). */
export function commandFor(
  invocation: LaunchInvocation,
  platform: NodeJS.Platform,
  instanceRunning: boolean,
): LaunchCommand {
  const { target, path, argv } = invocation;
  if (target.kind === "bundle") {
    if (platform === "darwin" && !instanceRunning) {
      return { file: "open", args: macOpenArgs(target.app, path, argv), macVerb: "open" };
    }
    return { file: target.exe, args: [...argv], macVerb: "exec" };
  }
  // A bare binary — degraded on macOS (exec'd in both cases), normal elsewhere.
  if (target.wrapper && target.wrapper.length > 0) {
    const [wrapperFile, ...wrapperArgs] = target.wrapper;
    return { file: wrapperFile, args: [...wrapperArgs, target.exe, ...argv] };
  }
  return { file: target.exe, args: [...argv] };
}

function spawnDetached(
  command: LaunchCommand,
  deps: LaunchDeps,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: SpawnedProcess;
    try {
      child = deps.spawn(command.file, command.args, {
        env: sanitisedEnv(deps.env, deps.platform),
        // Not the document's folder: a held handle there would block renames
        // and deletes on Windows for Constly's lifetime.
        cwd: deps.homedir(),
      });
    } catch (err) {
      reject(err);
      return;
    }
    // Exit or the settle window, whichever comes first — and the loser is
    // cancelled, so an early exit leaves no timer running behind it.
    let settled = false;
    let cancelSettle: (() => void) | undefined;
    const done = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      cancelSettle?.();
      outcome();
    };
    child.once("error", (err) => done(() => reject(err)));
    child.once("exit", () => done(resolve));
    child.once("spawn", () => {
      child.unref();
      if (!settled) cancelSettle = deps.setTimer(LAUNCH_SETTLE_MS, () => done(resolve));
    });
  });
}

/** One launch: pick the verb, spawn, wait for exit or the settle window. */
export async function launchOnce(invocation: LaunchInvocation, deps: LaunchDeps): Promise<LaunchCommand> {
  const needsRunningCheck = invocation.target.kind === "bundle" && deps.platform === "darwin";
  const running = needsRunningCheck ? await isInstanceRunning(invocation.target.exe, deps) : false;
  const command = commandFor(invocation, deps.platform, running);
  await spawnDetached(command, deps);
  return command;
}

export function createLauncher(deps: LaunchDeps): LaunchFn {
  return async (invocation) => {
    await launchOnce(invocation, deps);
  };
}
