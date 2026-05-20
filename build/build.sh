#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
NODE_MODULES="$ROOT_DIR/node_modules"

echo "=== Moodle CAPTCHA Solver: Build ==="

if [ ! -d "$NODE_MODULES/tesseract.js" ]; then
  echo "Error: node_modules not found. Run 'npm install' first."
  exit 1
fi

mkdir -p \
  "$ROOT_DIR/lib/tesseract" \
  "$ROOT_DIR/lib/tesseract-core" \
  "$ROOT_DIR/lib/traineddata"

# Tesseract.js main + worker
echo "Copying tesseract.js..."
cp "$NODE_MODULES/tesseract.js/dist/tesseract.min.js" "$ROOT_DIR/lib/tesseract/"
cp "$NODE_MODULES/tesseract.js/dist/worker.min.js" "$ROOT_DIR/lib/tesseract/"

# WASM core (LSTM + SIMD-LSTM only)
echo "Copying tesseract-core WASM..."
for variant in tesseract-core-lstm.wasm.js tesseract-core-simd-lstm.wasm.js; do
  if [ -f "$NODE_MODULES/tesseract.js-core/$variant" ]; then
    cp "$NODE_MODULES/tesseract.js-core/$variant" "$ROOT_DIR/lib/tesseract-core/"
  fi
done

# Trained data
echo "Copying traineddata..."
TRAINEDDATA="$NODE_MODULES/tesseract.js/lang-data/4.0.0_best/eng.traineddata.gz"
if [ -f "$TRAINEDDATA" ]; then
  cp "$TRAINEDDATA" "$ROOT_DIR/lib/traineddata/"
else
  echo "Warning: eng.traineddata.gz not found at $TRAINEDDATA"
  echo "You may need to download it manually from https://github.com/naptha/tessdata/tree/gh-pages/4.0.0_best"
fi

echo "=== Build complete ==="
echo "Files in lib/:"
find "$ROOT_DIR/lib" -type f | sort
