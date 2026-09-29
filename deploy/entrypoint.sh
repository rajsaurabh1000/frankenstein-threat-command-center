#!/usr/bin/env bash
# Runs the three Frankenstein components in one container. The bridge is the foreground process.
set -euo pipefail

DATA_DIR="${DATA_DIR:-/app/data}"
STOP="$DATA_DIR/.attack_stop"
mkdir -p "$DATA_DIR"
: > "$DATA_DIR/live_stream.log"
rm -f "$STOP"

echo "Legacy Logger (ASP.NET) on 127.0.0.1:5080"
dotnet /app/legacy/LegacyLogger.dll --urls http://127.0.0.1:5080 &

# AttackSim supervisor. AttackSim exits on Contain (stop flag); it restarts once the flag is
# cleared by Inject, or automatically after DEMO_AUTO_RESUME_SECONDS so a shared public demo
# never stays frozen for the next visitor (0 disables auto-resume).
AUTO_RESUME="${DEMO_AUTO_RESUME_SECONDS:-0}"
(
  while true; do
    if [[ -f "$STOP" ]]; then
      if (( AUTO_RESUME > 0 )) && (( $(date +%s) - $(stat -c %Y "$STOP") >= AUTO_RESUME )); then
        echo "Auto-resume: clearing containment after ${AUTO_RESUME}s"
        rm -f "$STOP"
      fi
    else
      pwsh -NoProfile -File /app/chaos/AttackSim.ps1 || true
    fi
    sleep 2
  done
) &

echo "Analytics Bridge + Command Center on 0.0.0.0:${PORT:-8000}"
exec /opt/venv/bin/python -m uvicorn main:app --app-dir /app/bridge --host 0.0.0.0 --port "${PORT:-8000}"
