"""Local (Hugging Face) models: one process-wide cache, and an availability check that never surprises.

Used by the sentence-transformers embedder and the cross-encoder reranker.
"""
from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any

from . import settings

log = logging.getLogger(__name__)
_models: dict[tuple[str, str], Any] = {}
_lock = threading.Lock()


def load(kind: str, name: str):
    """Load (once) a ``kind`` = "embedder" | "cross_encoder" model by Hub id or local folder."""
    key = (kind, name)
    with _lock:
        if key not in _models:
            log.info("loading %s model %s", kind, name)
            if kind == "cross_encoder":
                from sentence_transformers import CrossEncoder

                _models[key] = CrossEncoder(name, device="cpu")
            else:
                from sentence_transformers import SentenceTransformer

                _models[key] = SentenceTransformer(name, device="cpu")
        return _models[key]


def is_loaded(kind: str, name: str) -> bool:
    return (kind, name) in _models


def status(name: str) -> tuple[bool, str]:
    """Usable here? ok if it is a local folder, already in the HF cache, or (when not offline) downloadable."""
    if Path(name).expanduser().is_dir():
        return True, f"local folder {name}"
    try:
        from huggingface_hub import try_to_load_from_cache

        if isinstance(try_to_load_from_cache(name, "config.json"), str):
            return True, "cached locally"
    except Exception:  # noqa: BLE001
        pass
    advice = "Copy the model folder onto this machine and use its path as the model name."
    if settings.offline() or os.environ.get("HF_HUB_OFFLINE") == "1":
        return False, f"model '{name}' is not downloaded and offline mode forbids downloads. {advice}"
    try:
        import httpx

        httpx.head("https://huggingface.co", timeout=3, follow_redirects=True)
        return True, "not cached yet; downloads on first use"
    except Exception:  # noqa: BLE001
        return False, f"model '{name}' is not downloaded and huggingface.co is unreachable. {advice}"
