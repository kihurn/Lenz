#!/bin/bash
# Builds Lenz.app and a DMG for Apple Silicon. Run on the Mac from the app/ folder: npm run dist:mac
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname)" != "Darwin" ]]; then
  echo "build-mac.sh must run on macOS." >&2
  exit 1
fi

npm ci
bash scripts/build-ocr.sh
npx electron-vite build
npx electron-builder --mac --arm64 --dir

APP="dist/mac-arm64/Lenz.app"
# Apple Silicon only runs signed code; without a Developer ID we sign ad hoc.
codesign --force --deep --sign - "$APP"
codesign --verify --deep "$APP"

DMG="dist/Lenz-$(node -p "require('./package.json').version")-arm64.dmg"
rm -f "$DMG"
hdiutil create -volname Lenz -srcfolder "$APP" -ov -format UDZO "$DMG" >/dev/null
echo "Built $APP"
echo "Built $DMG"
