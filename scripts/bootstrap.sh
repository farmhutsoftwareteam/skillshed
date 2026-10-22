#!/usr/bin/env bash
# Installs the skillshed marketplace into Claude Code and Codex on this Mac.
# Packs in ALWAYS_ON are enabled everywhere; the rest are installed but
# disabled, and turned on per project with scripts/use-pack.sh.
#
#   scripts/bootstrap.sh                 # from GitHub (default source)
#   scripts/bootstrap.sh "$PWD"          # from this local checkout
#
# Safe to re-run: existing marketplaces and plugins are left in place.
# Ends by running scripts/doctor.sh, and exits non-zero unless it passes.
set -uo pipefail

SOURCE="${1:-farmhutsoftwareteam/skillshed}"
MARKET=skillshed
ALWAYS_ON=(core matt)
# Every other pack in this checkout.
PACKS=()
for d in "$(cd "$(dirname "$0")/.." && pwd)"/plugins/*/; do
  p="$(basename "$d")"; [[ " ${ALWAYS_ON[*]} " == *" $p "* ]] || PACKS+=("$p")
done

[ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"

find_claude() {
  command -v claude && return
  # Claude desktop bundles the CLI; use the newest copy.
  ls -d "$HOME/Library/Application Support/Claude/claude-code"/*/*/claude.app/Contents/MacOS/claude 2>/dev/null | sort -V | tail -1
}

FAILED=()
run() {
  local cmd="$1"; shift; echo "  \$ ${cmd##*/} $*"
  "$cmd" "$@" 2>&1 | sed 's/^/    /'
  local s=${PIPESTATUS[0]}
  [ "$s" -eq 0 ] || { echo "    exit $s"; FAILED+=("${cmd##*/} $*"); }
  return "$s"
}

CLAUDE="$(find_claude)"
if [ -n "$CLAUDE" ]; then
  echo "Claude Code: $CLAUDE"
  run "$CLAUDE" plugin marketplace add "$SOURCE" --scope user
  run "$CLAUDE" plugin marketplace update "$MARKET"
  for p in "${ALWAYS_ON[@]}"; do
    run "$CLAUDE" plugin install "$p@$MARKET" --scope user -y
    "$CLAUDE" plugin enable "$p@$MARKET" --scope user >/dev/null 2>&1  # no-op if already on
  done
  for p in "${PACKS[@]}"; do
    run "$CLAUDE" plugin install "$p@$MARKET" --scope user -y
    "$CLAUDE" plugin disable "$p@$MARKET" --scope user >/dev/null 2>&1  # errors if already off
  done
  # Third-party marketplaces don't auto-update by default; this one should.
  if [[ "$SOURCE" != /* ]]; then
    node -e '
      const fs = require("fs"), f = process.env.HOME + "/.claude/settings.json";
      const s = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
      const m = ((s.extraKnownMarketplaces ??= {})[process.argv[1]] ??= {});
      m.autoUpdate = true;
      fs.writeFileSync(f, JSON.stringify(s, null, 2) + "\n");
    ' "$MARKET" && echo "  auto-update on for $MARKET"
  fi
else
  echo "Claude Code not found: skipped (https://claude.com/claude-code)."
fi

echo
if command -v codex >/dev/null; then
  echo "Codex: $(command -v codex)"
  run codex plugin marketplace add "$SOURCE"
  [[ "$SOURCE" != /* ]] && run codex plugin marketplace upgrade "$MARKET"
  CONFIG="$HOME/.codex/config.toml"
  for p in "${ALWAYS_ON[@]}"; do
    run codex plugin add "$p@$MARKET"
    sed -i.bak "/^\[plugins\.\"$p@$MARKET\"\]/,/^\[/ s/^enabled = false/enabled = true/" "$CONFIG" && rm -f "$CONFIG.bak"
  done
  for p in "${PACKS[@]}"; do
    run codex plugin add "$p@$MARKET"
    # codex has no disable command: flip the entry `plugin add` just wrote.
    sed -i.bak "/^\[plugins\.\"$p@$MARKET\"\]/,/^\[/ s/^enabled = true/enabled = false/" "$CONFIG" && rm -f "$CONFIG.bak"
  done
  echo "  stack packs disabled in $CONFIG"
else
  echo "Codex not found: skipped (brew install --cask codex)."
fi

echo
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "Commands that failed:"
  printf '  %s\n' "${FAILED[@]}"
  echo
fi
echo "Checking the result:"
"$(dirname "$0")/doctor.sh" || exit 1
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "Packs are in place, but the commands listed above failed; their output is further up."
  exit 1
fi
