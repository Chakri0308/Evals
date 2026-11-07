#!/usr/bin/env bash
# RAG Lab - production (macOS/Linux). One process serves the built UI and the API on one port.
#   ./prod.sh [--rebuild]       RAG_LAB_HOST / RAG_LAB_PORT override 127.0.0.1:8765
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
. "$ROOT/scripts/common.sh"

start_ollama_if_installed
init_backend
init_frontend
if [ "$1" = "--rebuild" ] || [ ! -f "$ROOT/frontend/dist/index.html" ]; then (cd "$ROOT/frontend" && npm run build); fi

HOST="${RAG_LAB_HOST:-127.0.0.1}"; PORT="${RAG_LAB_PORT:-8765}"
echo; echo "  RAG Lab ->  http://$HOST:$PORT"; echo
cd "$ROOT/backend" && exec "$PY" -m uvicorn app.main:app --host "$HOST" --port "$PORT" --proxy-headers --timeout-graceful-shutdown 10
