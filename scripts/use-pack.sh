#!/usr/bin/env bash
# Turns stack packs on (or off) for the project in the current directory, for
# both Claude Code (.claude/settings.json) and Codex (.codex/config.toml).
# Commit both files so the project carries its packs to every machine.
#
#   use-pack.sh supabase inngest     # enable
#   use-pack.sh --off supabase       # disable again
#
# Codex only reads .codex/config.toml in projects you have trusted.
set -euo pipefail

MARKET=skillshed
VALUE=true
if [ "${1:-}" = "--off" ]; then VALUE=false; shift; fi
[ $# -gt 0 ] || { echo "usage: use-pack.sh [--off] <pack>..." >&2; exit 1; }

REPO="$(cd "$(dirname "$0")/.." && pwd)"
for p in "$@"; do
  [ -d "$REPO/plugins/$p" ] || { echo "unknown pack: $p (have: $(ls "$REPO/plugins" | tr '\n' ' '))" >&2; exit 1; }
done

mkdir -p .claude .codex

node -e '
  const fs = require("fs"), f = ".claude/settings.json";
  const [market, value, ...packs] = process.argv.slice(1);
  const s = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
  s.enabledPlugins ??= {};
  for (const p of packs) s.enabledPlugins[`${p}@${market}`] = value === "true";
  // Lets a fresh machine discover the marketplace from the project alone.
  (s.extraKnownMarketplaces ??= {})[market] ??= { source: { source: "github", repo: "farmhutsoftwareteam/skillshed" } };
  fs.writeFileSync(f, JSON.stringify(s, null, 2) + "\n");
' "$MARKET" "$VALUE" "$@"

TOML=.codex/config.toml
touch "$TOML"
for p in "$@"; do
  header="[plugins.\"$p@$MARKET\"]"
  if grep -qF "$header" "$TOML"; then
    sed -i.bak "/^\[plugins\.\"$p@$MARKET\"\]/,/^\[/ s/^enabled = .*/enabled = $VALUE/" "$TOML" && rm -f "$TOML.bak"
  else
    [ -s "$TOML" ] && echo >> "$TOML"
    printf '%s\nenabled = %s\n' "$header" "$VALUE" >> "$TOML"
  fi
done

echo "$([ "$VALUE" = true ] && echo Enabled || echo Disabled): $* (in .claude/settings.json and $TOML)"
echo "Restart the Claude Code / Codex session to pick it up."
