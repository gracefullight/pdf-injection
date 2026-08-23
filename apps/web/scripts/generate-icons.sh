#!/usr/bin/env bash
# Regenerates every raster icon under apps/web/public from the two SVG
# sources (public/icons/icon.svg, public/icons/icon-maskable.svg).
#
# This is an asset-generation helper, NOT an app build step — it is run by
# hand whenever the SVG artwork changes and its outputs are committed.
#
# Requirements (dev machine only, never needed at runtime / in Docker):
#   - rsvg-convert   (brew install librsvg)
#   - python3 + Pillow (for the multi-size favicon.ico)
#
# Outputs (referenced by index.html and manifest.ts):
#   public/icons/icon-192.png            any-purpose PWA icon
#   public/icons/icon-512.png            any-purpose PWA icon
#   public/icons/icon-maskable-512.png   maskable PWA icon (Android adaptive)
#   public/icons/apple-touch-icon.png    180×180, iOS home screen
#   public/favicon.ico                   16/32/48 multi-size legacy favicon
set -euo pipefail

cd "$(dirname "$0")/.."

command -v rsvg-convert >/dev/null || { echo "rsvg-convert not found (brew install librsvg)" >&2; exit 1; }
python3 -c 'import PIL' 2>/dev/null || { echo "python3 Pillow not found (pip install pillow)" >&2; exit 1; }

ICONS=public/icons
SRC="$ICONS/icon.svg"
SRC_MASKABLE="$ICONS/icon-maskable.svg"

render() { # render <svg> <size> <out.png>
  rsvg-convert -w "$2" -h "$2" "$1" -o "$3"
}

render "$SRC" 192 "$ICONS/icon-192.png"
render "$SRC" 512 "$ICONS/icon-512.png"
render "$SRC_MASKABLE" 512 "$ICONS/icon-maskable-512.png"
# Apple ignores the manifest and masks its own corners, so use the full-bleed
# (maskable) artwork — otherwise the navy rounded tile shows a second, inner
# radius on the home screen.
render "$SRC_MASKABLE" 180 "$ICONS/apple-touch-icon.png"

# favicon.ico — multi-size container (16/32/48) built from crisp per-size renders.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for s in 16 32 48; do render "$SRC" "$s" "$TMP/$s.png"; done
python3 - "$TMP" public/favicon.ico <<'PY'
import sys
from PIL import Image
tmp, out = sys.argv[1], sys.argv[2]
# Pillow silently drops any requested size larger than the *base* image, so the
# largest render must be the base and the smaller ones go in append_images.
frames = [Image.open(f"{tmp}/{s}.png").convert("RGBA") for s in (48, 32, 16)]
frames[0].save(out, format="ICO", sizes=[(48, 48), (32, 32), (16, 16)], append_images=frames[1:])
PY

echo "icons regenerated under $ICONS and public/favicon.ico"
