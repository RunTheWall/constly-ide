#!/usr/bin/env bash
#
# check-no-ai-attribution.sh — fail if AI/assistant attribution appears in a
# commit message, a commit's author/committer identity, or supplied PR text.
#
# Shared by the CI gate (.github/workflows/no-ai-attribution.yml) and the local
# git hooks (.githooks/*) so both enforce the identical rule. Policy: CLAUDE.md /
# DECISIONS #97 — no AI attribution in commits or PRs, ever.
#
# Usage:
#   check-no-ai-attribution.sh --message <file>        # one commit message (commit-msg hook)
#   check-no-ai-attribution.sh --range <base> <head>   # commit messages + identity across a range (CI)
#   check-no-ai-attribution.sh --text <file>           # arbitrary text, e.g. PR title+body (CI)
#
# Deliberately targets specific attribution CONSTRUCTS, not the bare word
# "claude" (which legitimately appears in this project's prose, docs, and code),
# so it does not false-positive on normal content. bash 3.2-safe (macOS local).

set -uo pipefail

# Attribution in free text (commit messages, PR title/body).
TEXT_RE='co-authored-by:[[:space:]]*claude|claude-session:|generated (with|by) claude|claude\.ai/code|claude\.com/claude-code|@anthropic\.com'
# Attribution in an author/committer identity ("Name <email>"). The @anthropic.com
# email catches every default assistant identity; the word-bounded "claude" catches
# a claude author name paired with some other email (portable stand-in for \bclaude\b,
# so "Claudette" etc. do not trip it).
IDENT_RE='@anthropic\.com|(^|[^[:alpha:]])claude([^[:alpha:]]|$)'

fail=0
flag() { # <where> <matched-lines>
  printf '  ✗ %s\n' "$1" >&2
  printf '%s\n' "$2" | sed 's/^/      /' >&2
  fail=1
}

scan_text() { # <where> <text>
  local hits
  hits="$(printf '%s\n' "$2" | grep -inE "$TEXT_RE" 2>/dev/null || true)"
  [ -n "$hits" ] && flag "$1" "$hits"
  return 0
}

scan_ident() { # <where> <identity "Name <email>">
  local hits
  hits="$(printf '%s\n' "$2" | grep -inE "$IDENT_RE" 2>/dev/null || true)"
  [ -n "$hits" ] && flag "$1" "$hits"
  return 0
}

case "${1:-}" in
  --message)
    [ $# -ge 2 ] || { echo "usage: $0 --message <file>" >&2; exit 2; }
    scan_text  "commit message"   "$(cat "$2")"
    # Identity of the commit that is about to be created (strip trailing "epoch tz").
    scan_ident "commit author"    "$(git var GIT_AUTHOR_IDENT    2>/dev/null | sed 's/ [0-9]* [-+0-9]*$//')"
    scan_ident "commit committer" "$(git var GIT_COMMITTER_IDENT 2>/dev/null | sed 's/ [0-9]* [-+0-9]*$//')"
    ;;
  --range)
    [ $# -ge 3 ] || { echo "usage: $0 --range <base> <head>" >&2; exit 2; }
    base="$2"; head="$3"
    for c in $(git rev-list "$base..$head" 2>/dev/null); do
      short="$(git rev-parse --short "$c")"
      scan_text  "commit $short message"   "$(git log -1 --format='%B' "$c")"
      scan_ident "commit $short author"    "$(git log -1 --format='%an <%ae>' "$c")"
      scan_ident "commit $short committer" "$(git log -1 --format='%cn <%ce>' "$c")"
    done
    ;;
  --text)
    [ $# -ge 2 ] || { echo "usage: $0 --text <file>" >&2; exit 2; }
    scan_text "text" "$(cat "$2")"
    ;;
  *)
    echo "usage: $0 --message <file> | --range <base> <head> | --text <file>" >&2
    exit 2
    ;;
esac

if [ "$fail" -ne 0 ]; then
  cat >&2 <<'EOF'

✖ AI/assistant attribution detected — blocked by policy (no AI mentions in
  commits or PRs; CLAUDE.md / DECISIONS #97).

  Disallowed: Co-Authored-By: Claude / Claude-Session: trailers, "Generated
  with/by Claude" footers, claude.ai/claude.com links, and @anthropic.com
  author or committer identities.

  Fix: rewrite the commit message and re-author with your own identity
  (git commit --amend --reset-author), or edit the PR title/body.
  Local hooks can be skipped with --no-verify, but the CI gate re-checks
  every push and pull request and cannot be bypassed.
EOF
  exit 1
fi
echo "✓ no AI/assistant attribution detected"
exit 0
