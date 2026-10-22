#!/usr/bin/env bash
# Renders the share card and icons from HTML with headless Chrome (macOS).
# Run after changing og.html or icon.html; commit the PNGs it writes.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../public"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

shot() { # <html> <out.png> <width> <height>
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --virtual-time-budget=4000 --window-size="$3,$4" --screenshot="$2" "file://$1" >/dev/null 2>&1
}

shot "$HERE/og.html" "$OUT/og.png" 1200 630
shot "$HERE/icon.html" "$HERE/icon-512.png" 512 512
sips -z 180 180 "$HERE/icon-512.png" --out "$OUT/apple-touch-icon.png" >/dev/null
sips -z 32 32 "$HERE/icon-512.png" --out "$OUT/favicon-32.png" >/dev/null
mv "$HERE/icon-512.png" "$OUT/icon-512.png"
ls -la "$OUT"/og.png "$OUT"/apple-touch-icon.png "$OUT"/favicon-32.png "$OUT"/icon-512.png
