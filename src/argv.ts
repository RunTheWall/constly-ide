// IDE contract v1 (docs/IDE-CONTRACT.md):
//
//   constly [--goto=<line>[:<col>]] [--from=<ide-id>[:<port>]] [--] <path>...
//
// Bridges emit only the single-token `--flag=value` form, always the literal
// `--`, and exactly one path per launch. `--goto` belongs to the first launch
// of a hand-off; `--from` to every launch.
import { IDE_ID_RE } from "./identity";

/** 1-based line and column; the column counts UTF-16 code units, which is also VS Code's unit. */
export interface Caret {
  line: number;
  col: number;
}

export function caretFromZeroBased(line0: number, character0: number): Caret {
  return { line: line0 + 1, col: character0 + 1 };
}

/** The raw `vscode.env.uriScheme`, if it is a valid contract id — otherwise the flag is omitted. */
export function fromIdFor(uriScheme: string | undefined): string | undefined {
  if (typeof uriScheme !== "string") return undefined;
  return IDE_ID_RE.test(uriScheme) ? uriScheme : undefined;
}

export interface ArgvOptions {
  goto?: Caret | undefined;
  from?: string | undefined;
}

export function buildArgv(path: string, options: ArgvOptions = {}): string[] {
  const argv: string[] = [];
  if (options.goto) argv.push(`--goto=${options.goto.line}:${options.goto.col}`);
  if (options.from) argv.push(`--from=${options.from}`);
  argv.push("--", path);
  return argv;
}

export interface PlannedLaunch {
  path: string;
  argv: string[];
}

/** One launch per path, in order; the caret rides on the first only. */
export function planLaunches(paths: readonly string[], options: ArgvOptions = {}): PlannedLaunch[] {
  return paths.map((path, i) => ({
    path,
    argv: buildArgv(path, { goto: i === 0 ? options.goto : undefined, from: options.from }),
  }));
}
