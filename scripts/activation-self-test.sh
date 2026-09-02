#!/usr/bin/env bash
#
# activation-self-test.sh — prove the E4 activation test can fail, then run it
# for real. A guard nobody has seen fail is not known to work.
#
#   1. Build the POISONED bundle (esbuild --activation-probe: activate() runs
#      an fs probe) and run the activation suite against it. It must fail, AND
#      the failure must carry the E4-VIOLATION marker — a failure for any other
#      reason (VS Code download, harness ordering, could-not-look) is reported
#      as exactly that, not as the expected negative result.
#   2. Rebuild the production bundle, assert the probe marker is gone, and run
#      the activation suite; it must pass.
#
# Exit codes: 0 both halves behaved; 1 a half misbehaved; 2 could not look
# (build or harness failure unrelated to the property under test).
set -uo pipefail
cd "$(dirname "$0")/.."

log="$(mktemp "${TMPDIR:-/tmp}/constly-activation-XXXXXX.log")"
trap 'rm -f "$log"' EXIT

run_activation() { # → exit status of vscode-test; output tee'd to $log
  if command -v xvfb-run >/dev/null 2>&1 && [ "$(uname -s)" = "Linux" ] && [ -z "${DISPLAY:-}" ]; then
    xvfb-run -a npx vscode-test --label activation 2>&1 | tee "$log"
  else
    npx vscode-test --label activation 2>&1 | tee "$log"
  fi
  return "${PIPESTATUS[0]}"
}

echo "── 1/2 poisoned bundle: the activation test must catch the probe"
node esbuild.mjs --activation-probe >/dev/null || { echo "✗ could not build the poisoned bundle" >&2; exit 2; }
grep -q 'constly-activation-probe' dist/extension.js || { echo "✗ poisoned bundle lacks the probe marker — nothing to catch" >&2; exit 2; }
npx tsc -p tsconfig.test.json || { echo "✗ could not compile the tests" >&2; exit 2; }

if run_activation; then
  echo "✗ the activation test PASSED against the poisoned bundle — the harness cannot see a start-up probe" >&2
  node esbuild.mjs >/dev/null
  exit 1
fi
if grep -q 'E4-VIOLATION' "$log"; then
  echo "✓ activation test failed against the poisoned bundle with the E4-VIOLATION marker (as it must)"
elif grep -q 'COULD-NOT-LOOK' "$log"; then
  echo "✗ the harness could not look:" >&2
  grep 'COULD-NOT-LOOK' "$log" | head -1 | sed 's/^/    /' >&2
  node esbuild.mjs >/dev/null
  exit 2
else
  echo "✗ the activation test failed against the poisoned bundle, but NOT because it caught the probe — see the log above" >&2
  node esbuild.mjs >/dev/null
  exit 2
fi

echo "── 2/2 production bundle: the activation test must pass"
node esbuild.mjs >/dev/null || { echo "✗ could not build the production bundle" >&2; exit 2; }
if grep -q 'constly-activation-probe' dist/extension.js; then
  echo "✗ the probe marker survived into the production bundle" >&2
  exit 1
fi
if run_activation; then
  echo "✓ activation test passes against the production bundle"
  exit 0
fi
echo "✗ the activation test failed against the production bundle" >&2
exit 1
