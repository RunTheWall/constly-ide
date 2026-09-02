#!/usr/bin/env bash
#
# lint-guard-self-test.sh — prove the ESLint capture guard fires, and only
# where it should.
#
# eslint.config.mjs forbids, in src/, every way of capturing an fs/child_process
# function at module scope (named/default imports, a renamed namespace,
# destructured require, top-level aliases, assignments, class fields, optional
# chains, array and object literals): the
# activation spies patch the module objects, and a captured function would
# slip past them while the positive control stayed green. The guard is keyed
# on the canonical namespace names (fs, fsp, cp), so innocent aliases of other
# modules must keep passing — a guard that cries wolf trains people to write
# eslint-disable comments that would also hide a real capture.
#
# Each fixture is linted via --stdin-filename under src/ (so the src/ rule
# block applies without writing into src/). Banned fixtures must FAIL with
# the guard's own message; allowed fixtures must pass clean.
#
# Exit codes: 0 every fixture behaved; 1 a fixture misbehaved (a banned form
# passed, or an allowed form failed); 2 could not look (eslint crashed or is
# missing) — "no work" is not "no problems".
set -uo pipefail
cd "$(dirname "$0")/.."

MSG='looked up at call time'
failed=0
banned=0
allowed=0

lint_stdin() { # <content> → eslint output on stdout; returns eslint's exit code
  printf '%s\n' "$1" | npx eslint --stdin --stdin-filename src/lint-guard-fixture.ts 2>&1
}

could_not_look() { # <name> <code> <output>
  echo "✗ $1: eslint could not run (exit $2)" >&2
  printf '%s\n' "$3" | sed 's/^/    /' >&2
  exit 2
}

expect_fail() { # <name> <content>
  local out code
  out="$(lint_stdin "$2")"; code=$?
  [ "$code" -lt 2 ] || could_not_look "$1" "$code" "$out"
  if [ "$code" -eq 1 ] && grep -q "$MSG" <<<"$out"; then
    echo "  ✓ banned:  $1"; banned=$((banned + 1))
  else
    echo "  ✗ NOT caught: $1 (eslint exit $code)" >&2
    printf '%s\n' "$out" | sed 's/^/    /' >&2
    failed=1
  fi
}

expect_pass() { # <name> <content>
  local out code
  out="$(lint_stdin "$2")"; code=$?
  [ "$code" -lt 2 ] || could_not_look "$1" "$code" "$out"
  if [ "$code" -eq 0 ]; then
    echo "  ✓ allowed: $1"; allowed=$((allowed + 1))
  else
    echo "  ✗ innocent form rejected: $1" >&2
    printf '%s\n' "$out" | sed 's/^/    /' >&2
    failed=1
  fi
}

# ── banned: how the watched modules may NOT enter src/ ──────────────────────

expect_fail "named import from node:fs" \
'import { existsSync } from "node:fs";
export const f = (p: string): boolean => existsSync(p);'

expect_fail "default import from fs" \
'import fs from "fs";
export const f = (p: string): boolean => fs.existsSync(p);'

expect_fail "named import from child_process" \
'import { spawn } from "child_process";
export const f = (): unknown => spawn("x", []);'

expect_fail "named import from node:child_process" \
'import { execFile } from "node:child_process";
export const f = (): unknown => execFile("x", []);'

expect_fail "named import from node:fs/promises" \
'import { readFile } from "node:fs/promises";
export const f = (p: string): Promise<Buffer> => readFile(p);'

expect_fail "namespace import under a non-canonical name (import * as banana)" \
'import * as banana from "node:fs";
export const f = (p: string): boolean => banana.existsSync(p);'

expect_fail "top-level require under a non-canonical name" \
'const banana = require("node:fs");
export const f = (p: string): boolean => banana.existsSync(p);'

expect_fail "top-level require under a non-canonical name, as-cast" \
'const banana = require("node:fs") as typeof import("node:fs");
export const f = (p: string): boolean => banana.existsSync(p);'

# ── banned: capture forms keyed on the namespace ────────────────────────────

expect_fail "destructured require of node:fs" \
'const { existsSync } = require("node:fs");
export const f = (p: string): boolean => existsSync(p);'

expect_fail "top-level alias: const existsSync = fs.existsSync" \
'import * as fs from "node:fs";
const existsSync = fs.existsSync;
export const f = (p: string): boolean => existsSync(p);'

expect_fail "exported top-level alias: export const spawn = cp.spawn" \
'import * as cp from "node:child_process";
export const spawn = cp.spawn;'

expect_fail "nested alias: const readFile = fs.promises.readFile" \
'import * as fs from "node:fs";
const readFile = fs.promises.readFile;
export const f = (p: string): Promise<Buffer> => readFile(p);'

expect_fail "require(...).member alias inside a function" \
'export function f(): unknown {
  const statSync = require("node:fs").statSync;
  return statSync;
}'

expect_fail "top-level destructuring of the namespace: const { execFile } = cp" \
'import * as cp from "node:child_process";
const { execFile } = cp;
export const f = (): unknown => execFile;'

expect_fail "top-level assignment: let f; f = fs.existsSync" \
'import * as fs from "node:fs";
let f: unknown;
f = fs.existsSync;
export { f };'

expect_fail "top-level destructuring assignment: ({ existsSync } = fs)" \
'import * as fs from "node:fs";
let existsSync: unknown;
({ existsSync } = fs);
export { existsSync };'

expect_fail "class field: static f = fs.existsSync" \
'import * as fs from "node:fs";
export class A {
  static f = fs.existsSync;
}'

# ── banned: the same captures through optional chains and array patterns ────

expect_fail "optional chain alias: const f = fs?.existsSync" \
'import * as fs from "node:fs";
const f = fs?.existsSync;
export { f };'

expect_fail "nested optional chain alias: const r = fs?.promises?.readFile" \
'import * as fs from "node:fs";
const r = fs?.promises?.readFile;
export { r };'

expect_fail "optional chain assignment: f = fs?.existsSync" \
'import * as fs from "node:fs";
let f: unknown;
f = fs?.existsSync;
export { f };'

expect_fail "optional chain class field: static f = fs?.existsSync" \
'import * as fs from "node:fs";
export class A {
  static f = fs?.existsSync;
}'

expect_fail "array pattern: const [f] = [fs.existsSync]" \
'import * as fs from "node:fs";
const [f] = [fs.existsSync];
export { f };'

expect_fail "object literal: const ops = { exists: fs.existsSync }" \
'import * as fs from "node:fs";
const ops = { exists: fs.existsSync, read: fs.readFileSync };
export { ops };'

expect_fail "exported object literal with an optional chain: export const ops = { spawn: cp?.spawn }" \
'import * as cp from "node:child_process";
export const ops = { spawn: cp?.spawn };'

# ── allowed: the canonical form, and innocent aliases of other modules ──────

expect_pass "namespace imports looked up at call time (fs, cp), in-function require alias" \
'import * as fs from "node:fs";
import * as cp from "node:child_process";
export function f(p: string): boolean {
  return fs.existsSync(p) && typeof cp.spawn === "function";
}
export function g(): typeof import("node:fs") {
  // A module-object alias inside a function stays live; only captured
  // functions are the problem.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("node:fs") as typeof import("node:fs");
  return mod;
}'

expect_pass "namespace import of node:fs/promises as fsp, looked up at call time" \
'import * as fsp from "node:fs/promises";
export const f = (p: string): Promise<Buffer> => fsp.readFile(p);'

expect_pass "innocent destructuring: const { join } = path" \
'import * as path from "node:path";
const { join } = path;
export const f = (a: string, b: string): string => join(a, b);'

expect_pass "innocent exported alias: export const T = vscode.ConfigurationTarget.Global" \
'import * as vscode from "vscode";
export const T = vscode.ConfigurationTarget.Global;'

expect_pass "innocent top-level alias: const RE = identity.IDE_ID_RE" \
'import * as identity from "./identity";
const RE = identity.IDE_ID_RE;
export const f = (s: string): boolean => RE.test(s);'

expect_pass "innocent optional chain: const t = vscode?.ConfigurationTarget" \
'import * as vscode from "vscode";
const t = vscode?.ConfigurationTarget;
export { t };'

expect_pass "innocent array pattern: const [a] = [path.sep]" \
'import * as path from "node:path";
const [a] = [path.sep];
export { a };'

expect_pass "innocent object literal: const o = { sep: path.sep }" \
'import * as path from "node:path";
const o = { sep: path.sep };
export { o };'

expect_pass "default parameter evaluated per call: (h = fs.existsSync) => h" \
'import * as fs from "node:fs";
export const g = (h = fs.existsSync): unknown => h;'

if [ "$failed" -ne 0 ]; then
  echo "✖ lint guard self-test: a fixture misbehaved" >&2
  exit 1
fi
echo "✓ lint guard self-test: ${banned} banned forms fail lint with the guard's message; ${allowed} allowed forms pass"
exit 0
