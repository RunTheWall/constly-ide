#!/usr/bin/env bash
#
# lint-guard-self-test.sh — prove the ESLint capture guard fires.
#
# eslint.config.mjs forbids, in src/, every way of capturing an fs/child_process
# function at module scope (named/default imports, destructured require,
# top-level aliases): the activation spies patch the module objects, and a
# captured function would slip past them while the positive control stayed
# green. A guard nobody has seen fail is not known to work, so each banned
# form is linted here as a fixture (via --stdin-filename, so the src/ rule
# block applies without writing into src/) and must FAIL with the guard's own
# message; a clean namespace-import file must pass.
#
# Exit codes: 0 every fixture behaved; 1 a fixture misbehaved (a banned form
# passed, or the clean form failed); 2 could not look (eslint crashed or is
# missing) — "no work" is not "no problems".
set -uo pipefail
cd "$(dirname "$0")/.."

MSG='looked up at call time'
failed=0

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
    echo "  ✓ banned: $1"
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
    echo "  ✓ allowed: $1"
  else
    echo "  ✗ clean form rejected: $1" >&2
    printf '%s\n' "$out" | sed 's/^/    /' >&2
    failed=1
  fi
}

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

expect_fail "destructured require of node:fs" \
'const { existsSync } = require("node:fs");
export const f = (p: string): boolean => existsSync(p);'

expect_fail "top-level alias of fs.existsSync" \
'import * as fs from "node:fs";
const existsSync = fs.existsSync;
export const f = (p: string): boolean => existsSync(p);'

expect_fail "exported top-level alias of cp.spawn" \
'import * as cp from "node:child_process";
export const spawn = cp.spawn;'

expect_fail "require(...).member alias inside a function" \
'export function f(): unknown {
  const statSync = require("node:fs").statSync;
  return statSync;
}'

expect_fail "top-level destructuring of the namespace" \
'import * as cp from "node:child_process";
const { execFile } = cp;
export const f = (): unknown => execFile;'

expect_pass "namespace imports looked up at call time" \
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

if [ "$failed" -ne 0 ]; then
  echo "✖ lint guard self-test: a fixture misbehaved" >&2
  exit 1
fi
echo "✓ lint guard self-test: every banned form fails lint with the guard's message; the clean form passes"
exit 0
