#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/frontend"
npm ci
npm run build
echo "Built Vite UI to dashboard/dist — run with BUILD_VITE_UI=1 ./scripts/start-demo.sh"
