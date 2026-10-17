#!/bin/bash
# Builds the lenz-ocr helper (Apple Vision). macOS only; needs Xcode Command Line Tools.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname)" != "Darwin" ]]; then
  echo "build-ocr.sh: skipped — the OCR helper can only be built on macOS." >&2
  exit 0
fi
mkdir -p native/ocr/build
swiftc -O native/ocr/main.swift -o native/ocr/build/lenz-ocr -framework Vision -framework ImageIO
echo "Built native/ocr/build/lenz-ocr"
