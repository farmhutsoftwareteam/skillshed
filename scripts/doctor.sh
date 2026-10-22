#!/usr/bin/env bash
# Checks that Skillshed is set up the way bootstrap.sh leaves it: for each
# agent found, every pack is installed, ALWAYS_ON packs are on and the rest
# are off at user scope. Prints one line per pack and exits non-zero if any
# agent is not ready, or if no agent is found at all.
#
#   scripts/doctor.sh       # or: skillshed doctor
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MARKET=skillshed
ALWAYS_ON=($(sed -n 's/^ALWAYS_ON=(\(.*\))/\1/p' "$ROOT/scripts/bootstrap.sh"))
PACKS=()
for d in "$ROOT"/plugins/*/; do PACKS+=("$(basename "$d")"); done

[ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"

find_claude() {
  command -v claude && return
  ls -d "$HOME/Library/Application Support/Claude/claude-code"/*/*/claude.app/Contents/MacOS/claude 2>/dev/null | sort -V | tail -1
}

found=0 problems=0
ok()   { printf '  ok    %s\n' "$*"; }
warn() { printf '  warn  %s\n' "$*"; }
bad()  { printf '  FAIL  %s\n' "$*"; problems=$((problems + 1)); }
want() { [[ " ${ALWAYS_ON[*]} " == *" $1 "* ]] && echo enabled || echo disabled; }

# check <pack> <state>: state is enabled, disabled or missing.
check() {
  local p="$1" state="$2" expect; expect="$(want "$p")"
  if [ "$state" = missing ]; then bad "$p not installed"
  elif [ "$state" = "$expect" ]; then ok "$p $state"
  elif [ "$expect" = disabled ]; then warn "$p enabled everywhere; packs like this are meant to be on per project (skillshed use $p)"
  else bad "$p disabled, but it should be on everywhere"
  fi
}

CLAUDE="$(find_claude)"
if [ -n "$CLAUDE" ]; then
  found=$((found + 1))
  echo "Claude Code: $CLAUDE"
  if ! command -v node >/dev/null; then
    bad "node not found, so plugin state can't be read (install Node.js 20+)"
  elif ! list="$("$CLAUDE" plugin list --json 2>&1)"; then
    bad "claude plugin list failed: $list"
  else
    for p in "${PACKS[@]}"; do
      check "$p" "$(node -e '
        const [id, json] = process.argv.slice(1);
        const e = JSON.parse(json).find((x) => x.id === id && x.scope === "user");
        console.log(e ? (e.enabled ? "enabled" : "disabled") : "missing");
      ' "$p@$MARKET" "$list")"
    done
  fi
else
  echo "Claude Code: not found"
fi

echo
if command -v codex >/dev/null; then
  found=$((found + 1))
  echo "Codex: $(command -v codex)"
  if ! list="$(codex plugin list 2>&1)"; then
    bad "codex plugin list failed: $list"
  else
    for p in "${PACKS[@]}"; do
      line="$(grep -E "^$p@$MARKET[[:space:]]" <<<"$list")"
      case "$line" in
        *"installed, enabled"*) check "$p" enabled ;;
        *"installed, disabled"*) check "$p" disabled ;;
        *) check "$p" missing ;;
      esac
    done
  fi
else
  echo "Codex: not found"
fi

echo
if [ "$found" -eq 0 ]; then
  echo "Not ready: neither Claude Code nor Codex was found."
  echo "Install one (https://claude.com/claude-code, or brew install --cask codex), then re-run the installer."
  exit 1
fi
if [ "$problems" -gt 0 ]; then
  echo "Not ready: $problems problem(s) above. Re-run the installer, or skillshed update, then skillshed doctor."
  exit 1
fi
echo "Ready."
