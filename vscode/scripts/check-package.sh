#!/usr/bin/env bash
#
# check-package.sh — guards on the packaged artifact.
#
#   * `vsce ls` must contain the bundle, manifest, README, CHANGELOG, LICENSE
#     and icon, and nothing from src/, test/, out/, node_modules/, no *.map,
#     no *.ts.
#   * dist/extension.js must not carry the activation-probe marker.
#   * the .vsix must be smaller than 1 MiB.
#
# Usage: check-package.sh                      (runs vsce ls + finds the newest .vsix)
#        check-package.sh --listing FILE VSIX  (fixture mode for the self-test)
#
# Exit codes: 0 clean; 1 a guard tripped; 2 could not look (no listing, no
# vsix, no bundle) — "no work" is not "no problems".
set -uo pipefail
cd "$(dirname "$0")/.."

LIMIT=$((1024 * 1024))
fail=0
flag() { printf '  ✗ %s\n' "$1" >&2; fail=1; }

if [ "${1:-}" = "--listing" ]; then
  [ $# -ge 3 ] || { echo "usage: $0 --listing FILE VSIX" >&2; exit 2; }
  listing="$(cat "$2")"; vsix="$3"; bundle="${4:-dist/extension.js}"
else
  listing="$(npx vsce ls --no-dependencies 2>/dev/null)" || { echo "✗ vsce ls failed — could not look" >&2; exit 2; }
  vsix="$(ls -t ./*.vsix 2>/dev/null | head -1)"
  bundle="dist/extension.js"
fi

[ -n "$listing" ] || { echo "✗ empty package listing — could not look" >&2; exit 2; }
[ -n "$vsix" ] && [ -f "$vsix" ] || { echo "✗ no .vsix to measure — run 'pnpm package' first" >&2; exit 2; }
[ -f "$bundle" ] || { echo "✗ $bundle missing — could not look" >&2; exit 2; }

for pat in '^src/' '^test/' '^out/' '^node_modules/' '\.map$' '\.ts$' '^scripts/' '^\.github/'; do
  hits="$(printf '%s\n' "$listing" | grep -E "$pat" || true)"
  [ -z "$hits" ] || flag "packaged files match $pat:"$'\n'"$(printf '%s\n' "$hits" | sed 's/^/      /')"
done
for must in '^dist/extension\.js$' '^package\.json$' '^README\.md$' '^CHANGELOG\.md$' '^LICENSE(\.md|\.txt)?$' '^icon\.png$'; do
  printf '%s\n' "$listing" | grep -Eq "$must" || flag "package is missing a file matching $must"
done

if grep -q 'constly-activation-probe' "$bundle"; then
  flag "$bundle carries the activation-probe marker (the self-test's poisoned build must never ship)"
fi

size=$(wc -c < "$vsix" | tr -d ' ')
if [ "$size" -ge "$LIMIT" ]; then
  flag "$vsix is $size bytes (limit $LIMIT)"
else
  echo "  $vsix: $size bytes (< 1 MiB)"
fi

if [ "$fail" -ne 0 ]; then
  echo "✖ package guard failed" >&2
  exit 1
fi
echo "✓ package guard: listing clean, no probe marker, size under 1 MiB"
exit 0
