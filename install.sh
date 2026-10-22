#!/usr/bin/env bash
# Skillshed installer for Claude Code and Codex (macOS / Linux).
#
#   curl -fsSL https://raw.githubusercontent.com/farmhutsoftwareteam/skillshed/main/install.sh | bash
#
# Clones the repo to ~/.skillshed (override with SKILLSHED_HOME), adds
# the marketplace and plugins to every tool it finds, and puts a
# `skillshed` command on your PATH. Safe to re-run; it updates in place.
set -euo pipefail

REPO="${SKILLSHED_REPO:-farmhutsoftwareteam/skillshed}"
HOME_DIR="${SKILLSHED_HOME:-$HOME/.skillshed}"

[ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
command -v git >/dev/null || { echo "skillshed needs git" >&2; exit 1; }
command -v node >/dev/null || echo "note: node (20+) not found; 'skillshed use/find' need it"

if [ -d "$HOME_DIR/.git" ]; then
  echo "Updating $HOME_DIR"
  git -C "$HOME_DIR" pull -q --ff-only
else
  echo "Cloning $REPO to $HOME_DIR"
  git clone -q "https://github.com/$REPO.git" "$HOME_DIR"
fi

"$HOME_DIR/scripts/bootstrap.sh" "$REPO"

# Put the CLI on PATH: first writable dir that is already on PATH, else ~/.local/bin.
BIN=""
for d in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin" "$HOME/bin"; do
  if [ -d "$d" ] && [ -w "$d" ] && [[ ":$PATH:" == *":$d:"* ]]; then BIN="$d"; break; fi
done
if [ -z "$BIN" ]; then
  BIN="$HOME/.local/bin"
  mkdir -p "$BIN"
  echo "Add $BIN to your PATH:  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc"
fi
ln -sf "$HOME_DIR/bin/skillshed" "$BIN/skillshed"

echo
echo "Skillshed installed. Restart Claude Code / Codex sessions to load them."
echo "  skillshed use supabase   # turn a pack on in the current project"
echo "  skillshed help"
