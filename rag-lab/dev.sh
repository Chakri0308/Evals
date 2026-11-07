#!/usr/bin/env bash
# RAG Lab - development (macOS/Linux/Git-Bash). API with auto-reload on :8765, Vite UI on :5173.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
. "$ROOT/scripts/common.sh"

start_ollama_if_installed
init_backend
init_frontend

(cd "$ROOT/backend" && "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload --reload-dir app --timeout-graceful-shutdown 3) &
API=$!
trap 'kill $API 2>/dev/null' EXIT
echo; echo "  RAG Lab (dev) ->  http://127.0.0.1:5173"; echo
cd "$ROOT/frontend" && npx vite --port 5173 --host 127.0.0.1
