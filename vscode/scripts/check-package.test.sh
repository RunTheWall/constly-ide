#!/usr/bin/env bash
#
# check-package.test.sh — fixture matrix for check-package.sh: clean listing
# passes; a leaked src/ file, a sourcemap, a probe marker, or an oversized
# vsix each fail; a missing vsix or empty listing is a distinct could-not-look.
set -uo pipefail
cd "$(dirname "$0")/.."

tmp="$(mktemp -d "${TMPDIR:-/tmp}/constly-pkg-test-XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

clean_listing() {
  printf '%s\n' "dist/extension.js" "package.json" "README.md" "CHANGELOG.md" "LICENSE" "icon.png"
}
printf 'x' > "$tmp/small.vsix"
head -c $((1024 * 1024)) /dev/zero > "$tmp/big.vsix"
printf 'bundle' > "$tmp/clean.js"
printf 'bundle constly-activation-probe' > "$tmp/poisoned.js"

expect() { # <expected exit> <name> <listing-file> <vsix> <bundle>
  local want="$1" name="$2"
  bash scripts/check-package.sh --listing "$3" "$4" "$5" >/dev/null 2>&1
  local got=$?
  if [ "$got" -eq "$want" ]; then
    echo "  ✓ $name → exit $got"
  else
    echo "  ✗ $name → exit $got (wanted $want)" >&2
    failed=1
  fi
}
failed=0

clean_listing > "$tmp/clean.txt"
expect 0 "clean listing, small vsix, clean bundle" "$tmp/clean.txt" "$tmp/small.vsix" "$tmp/clean.js"

{ clean_listing; echo "src/extension.ts"; } > "$tmp/src.txt"
expect 1 "src/ leaked into the package" "$tmp/src.txt" "$tmp/small.vsix" "$tmp/clean.js"

{ clean_listing; echo "dist/extension.js.map"; } > "$tmp/map.txt"
expect 1 "sourcemap in the package" "$tmp/map.txt" "$tmp/small.vsix" "$tmp/clean.js"

{ clean_listing; echo "node_modules/x/index.js"; } > "$tmp/nm.txt"
expect 1 "node_modules in the package" "$tmp/nm.txt" "$tmp/small.vsix" "$tmp/clean.js"

clean_listing | grep -v LICENSE > "$tmp/nolicense.txt"
expect 1 "LICENSE missing" "$tmp/nolicense.txt" "$tmp/small.vsix" "$tmp/clean.js"

expect 1 "probe marker in the bundle" "$tmp/clean.txt" "$tmp/small.vsix" "$tmp/poisoned.js"
expect 1 "vsix at the 1 MiB limit" "$tmp/clean.txt" "$tmp/big.vsix" "$tmp/clean.js"

: > "$tmp/empty.txt"
expect 2 "empty listing is could-not-look" "$tmp/empty.txt" "$tmp/small.vsix" "$tmp/clean.js"
expect 2 "missing vsix is could-not-look" "$tmp/clean.txt" "$tmp/nope.vsix" "$tmp/clean.js"
expect 2 "missing bundle is could-not-look" "$tmp/clean.txt" "$tmp/small.vsix" "$tmp/nope.js"

if [ "$failed" -ne 0 ]; then
  echo "✖ check-package self-test failed" >&2
  exit 1
fi
echo "✓ check-package self-test: every fixture behaved"
