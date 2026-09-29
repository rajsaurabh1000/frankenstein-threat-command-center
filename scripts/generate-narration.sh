#!/usr/bin/env bash
# Pre-generate Jenny neural MP3s for deploy (no edge-tts needed on Render).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="$ROOT/dashboard/assets/narration"
mkdir -p "$OUT"

if [[ ! -x bridge/.venv/bin/python ]]; then
  python3 -m venv bridge/.venv
  bridge/.venv/bin/pip install -q -r bridge/requirements.txt
fi

export DATA_DIR="$ROOT/data"
bridge/.venv/bin/pip install -q edge-tts
bridge/.venv/bin/python scripts/generate_narration.py

echo "Commit dashboard/assets/narration/ for static voice on production hosts."
