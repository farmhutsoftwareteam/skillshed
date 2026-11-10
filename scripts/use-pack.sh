#!/usr/bin/env bash
# Turns stack packs on (or off) for the project in the current directory, for
# both Claude Code (.claude/settings.json) and Codex (.codex/config.toml).
# Commit both files so the project carries its packs to every machine.
#
#   use-pack.sh supabase inngest     # enable (and un-exclude)
#   use-pack.sh --off supabase       # disable again
#   use-pack.sh --exclude supabase   # disable and never borrow its skills here
#
# Off packs aren't loaded, but core:skill-router may still borrow a matching
# skill from one. --exclude also lists the pack in .skillshed.json (commit it),
# which the router checks first. Re-enabling a pack drops it from that list.
#
# Codex only reads .codex/config.toml in projects you have trusted.
set -euo pipefail

MARKET=skillshed
VALUE=true
EXCLUDE=false
case "${1:-}" in
  --off) VALUE=false; shift ;;
  --exclude) VALUE=false; EXCLUDE=true; shift ;;
esac
[ $# -gt 0 ] || { echo "usage: use-pack.sh [--off|--exclude] <pack>..." >&2; exit 1; }

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

# Exclusion list: --exclude adds, enabling removes, plain --off leaves it alone.
if [ "$EXCLUDE" = true ] || [ "$VALUE" = true ]; then
  node -e '
    const fs = require("fs"), f = ".skillshed.json";
    const [mode, ...packs] = process.argv.slice(1);
    if (mode === "remove" && !fs.existsSync(f)) process.exit(0);
    const s = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
    const list = new Set(s.exclude ?? []);
    for (const p of packs) mode === "add" ? list.add(p) : list.delete(p);
    s.exclude = [...list].sort();
    if (!s.exclude.length) delete s.exclude;
    if (Object.keys(s).length) fs.writeFileSync(f, JSON.stringify(s, null, 2) + "\n");
    else fs.rmSync(f, { force: true });
  ' "$([ "$EXCLUDE" = true ] && echo add || echo remove)" "$@"
fi

if [ "$VALUE" = true ]; then
  echo "Enabled: $* (in .claude/settings.json and $TOML)"
elif [ "$EXCLUDE" = true ]; then
  echo "Excluded: $* (disabled in .claude/settings.json and $TOML, listed in .skillshed.json)"
  echo "The skill router won't use these packs' skills here. Commit .skillshed.json."
else
  echo "Disabled: $* (in .claude/settings.json and $TOML)"
  echo "Not loaded automatically, but the skill router may still borrow a matching"
  echo "skill and tell you. To stop that: skillshed exclude $*"
fi
echo "Restart the Claude Code / Codex session to pick it up."
