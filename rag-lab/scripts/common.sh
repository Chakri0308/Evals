# Shared steps for dev.sh / prod.sh (sourced). Expects ROOT to be set.

start_ollama_if_installed() {
  curl -s -m 2 http://127.0.0.1:11434/api/version >/dev/null && return 0
  if command -v ollama >/dev/null; then (ollama serve >/dev/null 2>&1 &); echo "started ollama"
  else echo "warning: Ollama not found - LLM answers fall back to extractive quotes" >&2; fi
}

# Creates backend/.venv on first run; sets PY to the venv's python
init_backend() {
  PY="$ROOT/backend/.venv/bin/python"; [ -f "$PY" ] || PY="$ROOT/backend/.venv/Scripts/python"
  if [ ! -f "$PY" ]; then
    python3 -m venv "$ROOT/backend/.venv"
    PY="$ROOT/backend/.venv/bin/python"; [ -f "$PY" ] || PY="$ROOT/backend/.venv/Scripts/python"
    "$PY" -m pip install torch --index-url https://download.pytorch.org/whl/cpu
    "$PY" -m pip install -r "$ROOT/backend/requirements.txt"
  fi
}

init_frontend() {
  [ -d "$ROOT/frontend/node_modules" ] || (cd "$ROOT/frontend" && npm install)
}
