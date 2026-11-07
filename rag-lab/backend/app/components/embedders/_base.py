"""Shared base for embedders."""
from __future__ import annotations

import numpy as np

from app.core.capability import Capability, guard_methods
from app.core.registry import Component


class BaseEmbedder(Capability, Component):
    """Subclass, implement ``embed_documents`` (+ ``available``), register with ``@register("embedder", name)``.
    Vectors must be float32 and L2-normalised (so dot product = cosine). Calls are policy-guarded."""

    policy_kind = "embeddings"

    def __init_subclass__(cls, **kw):
        super().__init_subclass__(**kw)
        guard_methods(cls, ("embed_documents", "embed_query"), "embeddings")

    def cache_id(self) -> dict:  # pragma: no cover - abstract
        raise NotImplementedError

    def embed_documents(self, texts: list[str]) -> np.ndarray:  # pragma: no cover - abstract
        raise NotImplementedError

    def embed_query(self, text: str) -> np.ndarray:
        return self.embed_documents([text])[0]


def normalise(v) -> np.ndarray:
    v = np.asarray(v, dtype=np.float32)
    return v / (np.linalg.norm(v, axis=1, keepdims=True) + 1e-9)
