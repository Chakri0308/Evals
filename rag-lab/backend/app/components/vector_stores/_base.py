"""Vector store interface. One file per backend; register with ``@register("vector_store", "<name>")``.

A *collection* holds the vectors of one chunk set embedded with one embedding model (name ``rag_<hash>``).
Stores read their connection settings (URLs, keys, DSNs) from .env, never from the UI, so secrets stay out of
pane configs and history files.

To add a backend (Qdrant, Weaviate, Milvus, Elasticsearch, ...): copy ``in_memory.py``, implement the six
methods, set ``label``/``needs`` and you're done; it appears in Settings and in every retriever's dropdown.
"""
from __future__ import annotations

from typing import Optional

import numpy as np

from app.core.registry import Component


class VectorStore(Component):
    # human-readable "what you need" shown in Settings when the store is unavailable
    needs: str = ""

    def available(self) -> tuple[bool, str]:
        """Real connection check (connect / list indexes). Returns (ok, detail-or-reason)."""
        return True, ""

    def location(self) -> str:
        return ""

    def count(self, name: str) -> int:
        """Vectors stored in collection ``name`` (0 if it does not exist)."""
        raise NotImplementedError

    def reset(self, name: str) -> None:
        """Drop collection ``name`` if it exists."""
        raise NotImplementedError

    def upsert(self, name: str, ids: list[str], vectors: np.ndarray, texts: list[str], metas: list[dict]) -> None:
        raise NotImplementedError

    def query(self, name: str, vector: np.ndarray, k: int) -> list[tuple[str, float]]:
        """Top-k (chunk_id, cosine similarity), best first. Vectors are L2-normalised."""
        raise NotImplementedError

    def collections(self) -> list[dict]:
        """[{name, count}] for the collections this app created."""
        return []

    def close(self) -> None:  # optional
        pass


def missing_package(pkg: str, pip: Optional[str] = None) -> str:
    return f"Python package '{pkg}' is not installed: pip install {pip or pkg}"
