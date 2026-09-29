#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="$HOME/.dotnet:$PATH"

mkdir -p data
: > data/live_stream.log
rm -f data/.attack_stop

# Prefer native Python on Apple Silicon (PowerShell under Rosetta often uses x86_64).
if [[ "$(uname -m)" == "arm64" ]] && command -v /usr/bin/arch >/dev/null 2>&1; then
  PYTHON_BOOT="arch -arm64 python3"
else
  PYTHON_BOOT="python3"
fi

venv_healthy() {
  [[ -x bridge/.venv/bin/python ]] &&
    bridge/.venv/bin/python -c "import pydantic_core" >/dev/null 2>&1
}

if ! venv_healthy; then
  if [[ -d bridge/.venv ]]; then
    echo "Recreating bridge/.venv (Python architecture mismatch — common when using x86_64 PowerShell)..."
    rm -rf bridge/.venv
  fi
  $PYTHON_BOOT -m venv bridge/.venv
fi

bridge/.venv/bin/python -m pip install -q -r bridge/requirements.txt

if ! venv_healthy; then
  echo "ERROR: bridge virtualenv failed pydantic import. Try: rm -rf bridge/.venv && ./scripts/start-demo.sh"
  exit 1
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
  .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
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
