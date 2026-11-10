#!/usr/bin/env bash
# Installs the skillshed marketplace into Claude Code and Codex on this Mac.
# A pack new to a tool is enabled everywhere if it is in ALWAYS_ON, otherwise
# installed but disabled, and turned on per project with scripts/use-pack.sh.
#
#   scripts/bootstrap.sh                 # from GitHub (default source)
#   scripts/bootstrap.sh "$PWD"          # from this local checkout
#
# Safe to re-run (skillshed update does): packs already installed keep their
# on/off state, and an autoUpdate you set in ~/.claude/settings.json stays.
# Every change it makes is read back; one that didn't take counts as failed.
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
ALL=("${ALWAYS_ON[@]}" "${PACKS[@]}")

# Only when Homebrew isn't on PATH yet, so a PATH that has it keeps its order.
case ":$PATH:" in *:/opt/homebrew/bin:*) ;; *) [ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)" ;; esac

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

want() { [[ " ${ALWAYS_ON[*]} " == *" $1 "* ]] && echo enabled || echo disabled; }
# lookup <pack> <lines>: the word after "<pack> " in lines of "<pack> <word>".
lookup() { sed -n "s/^$1 //p" <<<"$2"; }

# target <pack> <state before install>: the state the pack should end in.
# Only a pack new to the tool gets the default; one already there keeps its
# state, so an update never undoes a choice. Empty means leave it alone.
target() {
  local p="$1" was="$2" def; def="$(want "$1")"
  case "$was" in
    missing) echo "$def" ;;
    enabled|disabled)
      [ "$was" = "$def" ] || echo "  kept $p $was (already installed; new installs get $def)" >&2
      echo "$was" ;;
  esac
}

# Prints "<pack> enabled|disabled|missing" for each pack at user scope.
claude_states() {
  local json; json="$("$CLAUDE" plugin list --json 2>/dev/null)" || return 1
  node -e '
    const [market, json, ...packs] = process.argv.slice(1);
    const list = JSON.parse(json);
    for (const p of packs) {
      const e = list.find((x) => x.id === `${p}@${market}` && x.scope === "user");
      console.log(p, e ? (e.enabled ? "enabled" : "disabled") : "missing");
    }
  ' "$MARKET" "$json" "${ALL[@]}"
}

CLAUDE="$(find_claude)"
if [ -n "$CLAUDE" ]; then
  echo "Claude Code: $CLAUDE"
  # Without this we can't tell new packs from old, so on failure no pack is
  # switched on or off.
  before="$(claude_states)" || { echo "  can't read claude plugin list --json; leaving every pack's state alone"; FAILED+=("claude plugin list --json"); }
  run "$CLAUDE" plugin marketplace add "$SOURCE" --scope user
  run "$CLAUDE" plugin marketplace update "$MARKET"
  targets=""
  for p in "${ALL[@]}"; do
    run "$CLAUDE" plugin install "$p@$MARKET" --scope user -y
    targets+="$p $(target "$p" "$(lookup "$p" "${before:-}")")"$'\n'
  done
  now="$(claude_states)"
  for p in "${ALL[@]}"; do
    t="$(lookup "$p" "$targets")" s="$(lookup "$p" "$now")"
    [ -n "$t" ] && [ "$s" != "$t" ] && [ "$s" != missing ] || continue
    if [ "$t" = enabled ]; then run "$CLAUDE" plugin enable "$p@$MARKET" --scope user
    else run "$CLAUDE" plugin disable "$p@$MARKET" --scope user
    fi
  done
  # Read it all back: a command can exit 0 without doing anything.
  if after="$(claude_states)"; then
    for p in "${ALL[@]}"; do
      t="$(lookup "$p" "$targets")" s="$(lookup "$p" "$after")"
      [ -z "$t" ] || [ "$s" = "$t" ] || { echo "  $p@$MARKET is $s, expected $t"; FAILED+=("claude: $p@$MARKET $s, expected $t"); }
    done
  else
    FAILED+=("claude plugin list --json")
  fi
  # Third-party marketplaces don't auto-update by default; this one should,
  # unless autoUpdate is already set either way.
  if [[ "$SOURCE" != /* ]]; then
    node -e '
      const fs = require("fs"), f = process.env.HOME + "/.claude/settings.json", market = process.argv[1];
      const read = () => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {});
      const s = read(), m = ((s.extraKnownMarketplaces ??= {})[market] ??= {});
      if ("autoUpdate" in m) {
        if (m.autoUpdate !== true) console.log(`  kept auto-update off for ${market} (set in ${f})`);
        process.exit(0);
      }
      m.autoUpdate = true;
      fs.mkdirSync(require("path").dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(s, null, 2) + "\n");
      if (read().extraKnownMarketplaces?.[market]?.autoUpdate !== true) {
        console.log(`  autoUpdate did not stick in ${f}`);
        process.exit(1);
      }
      console.log(`  auto-update on for ${market}`);
    ' "$MARKET" || FAILED+=("set autoUpdate for $MARKET in ~/.claude/settings.json")
  fi
else
  echo "Claude Code not found: skipped (https://claude.com/claude-code)."
fi

echo
if command -v codex >/dev/null; then
  echo "Codex: $(command -v codex)"
  CONFIG="$HOME/.codex/config.toml"
  # codex_state <pack>: enabled, disabled, unset (no enabled line) or missing,
  # from the pack's [plugins."<pack>@skillshed"] table.
  codex_state() {
    [ -f "$CONFIG" ] || { echo missing; return; }
    awk -v h="[plugins.\"$1@$MARKET\"]" '
      $0 == h { t = 1; seen = 1; next }
      /^\[/ { t = 0 }
      t && /^enabled[ \t]*=/ { st = ($0 ~ /=[ \t]*true/) ? "enabled" : "disabled" }
      END { print seen ? (st ? st : "unset") : "missing" }
    ' "$CONFIG"
  }
  run codex plugin marketplace add "$SOURCE"
  [[ "$SOURCE" != /* ]] && run codex plugin marketplace upgrade "$MARKET"
  targets=""
  for p in "${ALL[@]}"; do
    was="$(codex_state "$p")"
    run codex plugin add "$p@$MARKET"
    targets+="$p $(target "$p" "$was")"$'\n'
  done
  for p in "${ALL[@]}"; do
    t="$(lookup "$p" "$targets")"
    [ -n "$t" ] && [ "$(codex_state "$p")" != "$t" ] || continue
    # codex has no disable command: edit the entry `plugin add` wrote.
    v=true; [ "$t" = disabled ] && v=false
    sed -i.bak "/^\[plugins\.\"$p@$MARKET\"\]/,/^\[/ s/^enabled[[:space:]]*=.*/enabled = $v/" "$CONFIG" && rm -f "$CONFIG.bak"
  done
  for p in "${ALL[@]}"; do
    t="$(lookup "$p" "$targets")" s="$(codex_state "$p")"
    [ -z "$t" ] || [ "$s" = "$t" ] || { echo "  $p@$MARKET is $s in $CONFIG, expected $t"; FAILED+=("codex: $p@$MARKET $s, expected $t"); }
  done
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
