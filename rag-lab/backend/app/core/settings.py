"""App-wide settings: which LLM / embedding model / vector DB to use by default, and what is allowed.

Precedence (low → high): built-in defaults → .env → data/settings.json (changed from the UI).

Policy switches (for locked-down environments such as an office laptop):

  RAG_LAB_ALLOW_LLM=false          never call any LLM (Ollama, Claude, OpenAI, Gemini, ...).
                                   Answers fall back to the extractive (no-LLM) answerer.
  RAG_LAB_ALLOW_EMBEDDINGS=false   never load/call embedding or reranker models (local or remote).
                                   Semantic/hybrid panes report what is missing instead of running.
  RAG_LAB_OFFLINE=true             both of the above, plus no model downloads (HF_HUB_OFFLINE).

A switch set to false in .env is *locked*: the UI shows it and cannot turn it back on.
"""
from __future__ import annotations

import json
import os
import threading
from typing import Any

from .cache import DATA_DIR

_lock = threading.Lock()
_FILE = DATA_DIR / "settings.json"

BUILTIN = {
    "llm_provider": "ollama",
    "llm_model": "",  # "" = the provider's own default model
    "embedding_model": "local:BAAI/bge-small-en-v1.5",
    "vector_store": "chroma",
    "allow_llm": True,
    "allow_embeddings": True,
}

ENV_MAP = {
    "llm_provider": "LLM_PROVIDER",
    "llm_model": "LLM_MODEL",
    "embedding_model": "EMBEDDING_MODEL",
    "vector_store": "VECTOR_STORE",
    "allow_llm": "RAG_LAB_ALLOW_LLM",
    "allow_embeddings": "RAG_LAB_ALLOW_EMBEDDINGS",
}


def _truthy(v: str) -> bool:
    return v.strip().lower() not in ("0", "false", "no", "off", "")


def offline() -> bool:
    return _truthy(os.environ.get("RAG_LAB_OFFLINE", "false"))


def locks() -> dict[str, str]:
    """Policy switches that .env forces off (key -> human-readable reason)."""
    out = {}
    if offline():
        out["allow_llm"] = out["allow_embeddings"] = "RAG_LAB_OFFLINE=true in .env"
    for key in ("allow_llm", "allow_embeddings"):
        v = os.environ.get(ENV_MAP[key])
        if v is not None and v.strip() and not _truthy(v):
            out[key] = f"{ENV_MAP[key]}=false in .env"
    return out


def _file() -> dict:
    try:
        return json.loads(_FILE.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def get() -> dict[str, Any]:
    s = dict(BUILTIN)
    for key, env in ENV_MAP.items():
        v = os.environ.get(env)
        if v is not None and v.strip():
            s[key] = _truthy(v) if key.startswith("allow_") else v.strip()
    s.update({k: v for k, v in _file().items() if k in BUILTIN})
    for key in locks():
        s[key] = False
    return s


def update(changes: dict[str, Any]) -> dict[str, Any]:
    lk = locks()
    bad = [k for k in changes if k not in BUILTIN]
    if bad:
        raise ValueError(f"Unknown setting(s): {bad}")
    for k, v in changes.items():
        if k in lk and v:
            raise PermissionError(f"'{k}' is locked off by {lk[k]}")
    with _lock:
        cur = _file()
        cur.update(changes)
        _FILE.parent.mkdir(parents=True, exist_ok=True)
        _FILE.write_text(json.dumps(cur, indent=2), encoding="utf-8")
    return get()


def llm_allowed() -> bool:
    return bool(get()["allow_llm"])


def embeddings_allowed() -> bool:
    return bool(get()["allow_embeddings"])


def apply_process_env() -> None:
    """Called at startup: make HF libraries refuse to download when offline."""
    if offline():
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")


class Unavailable(Exception):
    """A component cannot run here (policy, missing key/package/model, unreachable service).

    The pipeline treats this as "fall back / not ready", never as a crash.
    """

    def __init__(self, reason: str, *, what: str = "", fix: str = ""):
        super().__init__(reason)
        self.reason, self.what, self.fix = reason, what, fix


POLICY_LLM = "LLM calls are switched off (no-LLM mode)"
POLICY_EMB = "Embedding/reranker models are switched off"
