#!/usr/bin/env bash
# Installs the munya marketplace into Claude Code and Codex on this Mac.
# core is enabled everywhere; stack packs are installed but disabled, and
# turned on per project with scripts/use-pack.sh.
#
#   scripts/bootstrap.sh                 # from GitHub (default source)
#   scripts/bootstrap.sh "$PWD"          # from this local checkout
#
# Safe to re-run: existing marketplaces and plugins are left in place.
set -uo pipefail

SOURCE="${1:-farmhutsoftwareteam/munya-skills}"
MARKET=munya
CORE=core
PACKS=(nextjs-vercel supabase expo inngest)

[ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"

find_claude() {
  command -v claude && return
  # Claude desktop bundles the CLI; use the newest copy.
  ls -d "$HOME/Library/Application Support/Claude/claude-code"/*/*/claude.app/Contents/MacOS/claude 2>/dev/null | sort -V | tail -1
}

run() { local cmd="$1"; shift; echo "  \$ ${cmd##*/} $*"; "$cmd" "$@" 2>&1 | sed 's/^/    /'; }

CLAUDE="$(find_claude)"
if [ -n "$CLAUDE" ]; then
  echo "Claude Code: $CLAUDE"
  run "$CLAUDE" plugin marketplace add "$SOURCE" --scope user
  run "$CLAUDE" plugin marketplace update "$MARKET"
  run "$CLAUDE" plugin install "$CORE@$MARKET" --scope user -y
  for p in "${PACKS[@]}"; do
    run "$CLAUDE" plugin install "$p@$MARKET" --scope user -y
    run "$CLAUDE" plugin disable "$p@$MARKET" --scope user
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
  echo "Claude Code not found: install it (https://claude.com/claude-code) and re-run."
fi

echo
if command -v codex >/dev/null; then
  echo "Codex: $(command -v codex)"
  run codex plugin marketplace add "$SOURCE"
  [[ "$SOURCE" != /* ]] && run codex plugin marketplace upgrade "$MARKET"
  run codex plugin add "$CORE@$MARKET"
  CONFIG="$HOME/.codex/config.toml"
  for p in "${PACKS[@]}"; do
    run codex plugin add "$p@$MARKET"
    # codex has no disable command: flip the entry `plugin add` just wrote.
    sed -i '' "/^\[plugins\.\"$p@$MARKET\"\]/,/^\[/ s/^enabled = true/enabled = false/" "$CONFIG"
  done
  echo "  stack packs disabled in $CONFIG"
else
  echo "Codex not found: brew install --cask codex, then re-run."
fi

echo
echo "Done. Restart Claude Code / Codex sessions to load skills."
echo "Turn a stack pack on in a project: $(cd "$(dirname "$0")" && pwd)/use-pack.sh <pack>"
