#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="$HOME/.dotnet:$PATH"

mkdir -p data
: > data/live_stream.log
rm -f data/.attack_stop

if [[ ! -d bridge/.venv ]]; then
  python3 -m venv bridge/.venv
  bridge/.venv/bin/pip install -q -r bridge/requirements.txt
else
  bridge/.venv/bin/pip install -q -r bridge/requirements.txt
fi

cleanup() {
  [[ -n "${LEGACY_PID:-}" ]] && kill "$LEGACY_PID" 2>/dev/null || true
  [[ -n "${BRIDGE_PID:-}" ]] && kill "$BRIDGE_PID" 2>/dev/null || true
  [[ -n "${ATTACK_PID:-}" ]] && kill "$ATTACK_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting Legacy Logger (ASP.NET) on :5080..."
(cd legacy && dotnet run --urls http://127.0.0.1:5080) &
LEGACY_PID=$!

echo "Starting Analytics Bridge (Python) on :8000..."
(
  cd bridge
  export DATA_DIR="$ROOT/data"
  export LEGACY_API_URL="http://127.0.0.1:5080"
  if [[ -f "$ROOT/.env" ]]; then set -a; source "$ROOT/.env"; set +a; fi
  .venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
) &
BRIDGE_PID=$!

sleep 3

if command -v pwsh >/dev/null 2>&1; then
  echo "Starting AttackSim (PowerShell)..."
  pwsh -File "$ROOT/chaos/AttackSim.ps1" &
  ATTACK_PID=$!
else
  echo "pwsh not found — install PowerShell or run: pwsh -File chaos/AttackSim.ps1"
fi

echo ""
echo "Threat Command Center: http://127.0.0.1:8000"
if command -v open >/dev/null 2>&1; then
  open "http://127.0.0.1:8000"
fi

wait "$BRIDGE_PID"
