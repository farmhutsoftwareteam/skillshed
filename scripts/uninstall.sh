#!/usr/bin/env bash
# Removes what install.sh put on this machine: the packs and marketplace in
# Claude Code (user scope) and Codex, their entries in ~/.claude/settings.json
# and ~/.codex/config.toml, the `skillshed` command, and the checkout itself.
# Personal skills stay unless you pass --personal. Prints a preview and
# changes nothing unless you pass --yes.
#
#   scripts/uninstall.sh                    # or: skillshed uninstall
#   scripts/uninstall.sh --yes              # do it
#   scripts/uninstall.sh --yes --personal   # also remove your personal skills
set -uo pipefail

# Everything runs inside main, which bash reads in full before running it,
# so deleting the checkout (and this file) as the last step is safe.
main() {
  local YES=0 PERSONAL=0
  for a in "$@"; do
    case "$a" in
      --yes|-y) YES=1 ;;
      --personal) PERSONAL=1 ;;
      -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; return 0 ;;
      *) echo "usage: skillshed uninstall [--yes] [--personal]" >&2; return 1 ;;
    esac
  done

  local MARKET=skillshed
  local ROOT; ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  local CHECKOUT="${SKILLSHED_HOME:-$HOME/.skillshed}"
  local CHECKOUT_REAL; CHECKOUT_REAL="$(cd "$CHECKOUT" 2>/dev/null && pwd -P || echo "$CHECKOUT")"
  local AGENTS="$HOME/.agents/skills" CSKILLS="$HOME/.claude/skills"
  local LOCK="${XDG_CONFIG_HOME:-$HOME/.config}/skillshed/personal.lock.json"
  local SETTINGS="$HOME/.claude/settings.json" TOML="$HOME/.codex/config.toml"
  local HAVE_NODE=0; command -v node >/dev/null && HAVE_NODE=1
  # Appended, not prepended, so a claude or codex already on PATH wins.
  [ -d /opt/homebrew/bin ] && PATH="$PATH:/opt/homebrew/bin"

  local KEEP=() FAILED=() n=0
  # step "<what>" cmd args...: prints it in a preview, runs it with --yes.
  step() {
    local what="$1" out; shift; n=$((n + 1))
    if [ "$YES" -eq 0 ]; then echo "  $what"; return; fi
    if out="$("$@" 2>&1)"; then echo "  removed  $what"
    else
      echo "  FAIL     $what"
      [ -n "$out" ] && printf '%s\n' "$out" | sed 's/^/           /'
      FAILED+=("$what")
    fi
  }

  # Skillshed keys in ~/.claude/settings.json; with "apply", deletes them.
  settings_keys() {
    [ -f "$SETTINGS" ] && [ "$HAVE_NODE" -eq 1 ] || return 0
    node -e '
      const fs = require("fs"), [f, m, mode] = process.argv.slice(1);
      const s = JSON.parse(fs.readFileSync(f, "utf8")), found = [];
      if (s.extraKnownMarketplaces && m in s.extraKnownMarketplaces) {
        found.push(`extraKnownMarketplaces.${m}`);
        if (mode === "apply") delete s.extraKnownMarketplaces[m];
      }
      for (const k of Object.keys(s.enabledPlugins ?? {})) {
        if (!k.endsWith("@" + m)) continue;
        found.push(`enabledPlugins["${k}"]`);
        if (mode === "apply") delete s.enabledPlugins[k];
      }
      if (mode === "apply") fs.writeFileSync(f, JSON.stringify(s, null, 2) + "\n");
      else if (found.length) console.log(found.join(", "));
    ' "$SETTINGS" "$MARKET" "$@"
  }
  # Skillshed tables in ~/.codex/config.toml; with "apply", deletes them
  # (each runs from its header to the next header).
  toml_tables() {
    [ -f "$TOML" ] || return 0
    local prog='/^\[/ { skip = ($0 ~ /^\[plugins\."[^"]*@skillshed"\][ \t]*$/ || $0 ~ /^\[marketplaces\.skillshed(\.[^]]*)?\][ \t]*$/); if (skip && mode != "apply") print }
      mode == "apply" && !skip'
    if [ "${1:-}" = apply ]; then
      local tmp; tmp="$(mktemp)" || return 1
      awk -v mode=apply "$prog" "$TOML" > "$tmp" && cat "$tmp" > "$TOML"; local s=$?
      rm -f "$tmp"; return $s
    fi
    awk "$prog" "$TOML" | paste -sd ' ' -
  }

  find_claude() {
    command -v claude && return
    ls -d "$HOME/Library/Application Support/Claude/claude-code"/*/*/claude.app/Contents/MacOS/claude 2>/dev/null | sort -V | tail -1
  }

  if [ "$YES" -eq 1 ]; then echo "Removing Skillshed:"; else echo "Would remove:"; fi

  local CLAUDE p list projects=""; CLAUDE="$(find_claude)"
  if [ -n "$CLAUDE" ]; then
    local cpacks=""
    if [ "$HAVE_NODE" -eq 1 ] && list="$("$CLAUDE" plugin list --json 2>/dev/null)"; then
      cpacks="$(node -e '
        const [m, json] = process.argv.slice(1), a = JSON.parse(json).filter((x) => x.id.endsWith("@" + m));
        for (const x of a) if (x.scope === "user") console.log(x.id.slice(0, -m.length - 1));
      ' "$MARKET" "$list")"
      projects="$(node -e '
        const [m, json] = process.argv.slice(1), a = JSON.parse(json).filter((x) => x.id.endsWith("@" + m));
        const p = [...new Set(a.filter((x) => x.scope !== "user" && x.projectPath).map((x) => x.projectPath))].filter((d) => require("fs").existsSync(d));
        console.log([...p.slice(0, 10), ...(p.length > 10 ? [`and ${p.length - 10} more`] : [])].join("\n"));
      ' "$MARKET" "$list")"
    else
      cpacks="$(ls "$ROOT/plugins")"  # can't read the list: try every pack
    fi
    for p in $cpacks; do
      step "Claude Code plugin $p@$MARKET (user scope)" "$CLAUDE" plugin uninstall "$p@$MARKET" --scope user
    done
    local ml  # if the list can't be read, try the removal anyway
    if ! ml="$("$CLAUDE" plugin marketplace list --json 2>/dev/null)" || grep -q "\"name\": *\"$MARKET\"" <<<"$ml"; then
      step "Claude Code marketplace $MARKET (user scope)" "$CLAUDE" plugin marketplace remove "$MARKET" --scope user
    fi
  fi
  local keys; keys="$(settings_keys)"
  [ -n "$keys" ] && step "$keys in $SETTINGS" settings_keys apply
  [ -f "$SETTINGS" ] && [ "$HAVE_NODE" -eq 0 ] && grep -q "$MARKET" "$SETTINGS" && KEEP+=("Skillshed entries in $SETTINGS (node not found, so not edited)")

  if command -v codex >/dev/null; then
    for p in $(codex plugin list 2>/dev/null | sed -n "s/^\([a-z0-9-]*\)@$MARKET[[:space:]][[:space:]]*installed.*/\1/p" | sort -u); do
      step "Codex plugin $p@$MARKET" codex plugin remove "$p@$MARKET"
    done
    codex plugin marketplace list 2>/dev/null | grep -qE "^$MARKET[[:space:]]" &&
      step "Codex marketplace $MARKET" codex plugin marketplace remove "$MARKET"
  fi
  # Whatever the codex commands leave behind, or all of it if codex is gone.
  local tables; tables="$(toml_tables)"
  [ -n "$tables" ] && step "$tables in $TOML" toml_tables apply

  # The command, only where it links into this checkout.
  local d l t seen=" "
  for d in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin" "$HOME/bin" "$(dirname "$(command -v skillshed 2>/dev/null || echo /nonexistent/x)")"; do
    l="$d/skillshed"
    case "$seen" in *" $l "*) continue ;; esac; seen="$seen$l "
    [ -L "$l" ] || continue
    t="$(readlink "$l")"
    case "$t" in
      "$CHECKOUT"/*|"$CHECKOUT_REAL"/*) step "$l (link to $t)" rm -f "$l" ;;
      *) KEEP+=("$l: links to $t, not to $CHECKOUT") ;;
    esac
  done

  # Personal skills: only the ones in the lock, and only our own links.
  local mine=""
  if [ -f "$LOCK" ] && [ "$HAVE_NODE" -eq 1 ]; then
    mine="$(node -e '
      const l = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      for (const k of Object.keys(l.skills ?? {})) if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(k)) console.log(k);
    ' "$LOCK")"
  fi
  if [ "$PERSONAL" -eq 1 ]; then
    for p in $mine; do
      [ -e "$AGENTS/$p" ] || [ -L "$AGENTS/$p" ] && step "personal skill $AGENTS/$p" rm -rf "$AGENTS/$p"
      [ -L "$CSKILLS/$p" ] && [ "$(readlink "$CSKILLS/$p")" = "$AGENTS/$p" ] && step "$CSKILLS/$p (link)" rm -f "$CSKILLS/$p"
    done
    [ -f "$LOCK" ] && step "$LOCK" rm -f "$LOCK"
  elif [ -n "$mine" ]; then
    KEEP+=("personal skills: $(echo $mine | sed 's/ /, /g') in $AGENTS (linked from $CSKILLS), and $LOCK. Add --personal to remove them too")
  fi

  # The checkout goes last: it holds this script.
  if [ -f "$CHECKOUT/bin/skillshed" ] && [ -f "$CHECKOUT/scripts/bootstrap.sh" ]; then
    cd "$HOME" || cd /
    step "$CHECKOUT (the Skillshed checkout)" rm -rf "$CHECKOUT"
  elif [ -e "$CHECKOUT" ]; then
    KEEP+=("$CHECKOUT: not a Skillshed checkout, left alone")
  fi
  [ "$n" -eq 0 ] && echo "  nothing: Skillshed is not installed here"

  echo
  echo "Left on this machine:"
  echo "  - entries that \`skillshed use\` wrote in projects (.claude/settings.json, .codex/config.toml). In each project:"
  echo "      git grep -l '@skillshed' -- .claude .codex"
  if [ -n "$projects" ]; then
    echo "    Claude Code has project-scope Skillshed installs in:"
    printf '%s\n' "$projects" | sed 's/^/      /'
  fi
  for p in ${KEEP[@]+"${KEEP[@]}"}; do echo "  - $p"; done
  for p in ${FAILED[@]+"${FAILED[@]}"}; do echo "  - failed, remove by hand: $p"; done

  echo
  if [ "$YES" -eq 0 ]; then
    echo "Nothing changed. Run: skillshed uninstall --yes$([ "$PERSONAL" -eq 1 ] && echo ' --personal')"
    return 0
  fi
  if [ ${#FAILED[@]} -gt 0 ]; then
    echo "Skillshed is partly removed; see the failures above."
    return 1
  fi
  echo "Skillshed is removed. Restart Claude Code / Codex sessions."
}
main "$@"; exit
