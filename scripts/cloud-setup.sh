#!/usr/bin/env bash
# Prepares a fresh Claude cloud container to render posts. Run once at the start of a cloud run:
#   bash scripts/cloud-setup.sh
# - Python: `pip` there installs into a different Python than `python3`, so this uses `python3 -m pip`.
# - Chromium: the container can't download Playwright's browser, but has a newer Chromium preinstalled
#   under $PLAYWRIGHT_BROWSERS_PATH. If the download fails, this points Playwright's expected path at it.
set -euo pipefail
cd "$(dirname "$0")/.."

python3 -m pip install -q numpy scipy pillow
npm install --silent

if npx playwright install chromium >/dev/null 2>&1; then
  echo "chromium: installed"
else
  browsers="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
  want=$(node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('node_modules/playwright-core/browsers.json','utf8'));console.log(j.browsers.find(b=>b.name==='chromium-headless-shell').revision)")
  have=$(ls -d "$browsers"/chromium_headless_shell-* 2>/dev/null | grep -v "chromium_headless_shell-$want$" | sort -V | tail -1)
  if [ -z "$have" ]; then echo "chromium: download failed and no preinstalled build in $browsers" >&2; exit 1; fi
  target="$browsers/chromium_headless_shell-$want/chrome-linux"
  mkdir -p "$target"
  ln -sf "$have/chrome-headless-shell-linux64/chrome-headless-shell" "$target/headless_shell"
  touch "$browsers/chromium_headless_shell-$want/INSTALLATION_COMPLETE" "$browsers/chromium_headless_shell-$want/DEPENDENCIES_VALIDATED"
  echo "chromium: using preinstalled $(basename "$have") for Playwright's build $want"
fi

python3 -c 'import numpy, scipy, PIL' && ffmpeg -version >/dev/null && echo "ready to render"
