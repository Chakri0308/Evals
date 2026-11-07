"""Embedding-model specs: ``provider:model`` strings (or ``default`` = Settings) → embedder components.

One place for the naming scheme used by retrievers, the MMR reranker, question analysis and startup warm-up.
"""
from __future__ import annotations

from . import settings
from .registry import create

# provider prefix → registered embedder component
PREFIX = {"local": "sentence_transformers", "st": "sentence_transformers", "ollama": "ollama",
          "openai": "openai", "gemini": "gemini"}

EXAMPLES = [
    "default", "local:BAAI/bge-small-en-v1.5", "local:BAAI/bge-base-en-v1.5", "local:sentence-transformers/all-MiniLM-L6-v2",
    "ollama:nomic-embed-text", "openai:text-embedding-3-small", "openai:text-embedding-3-large",
    "gemini:gemini-embedding-001",
]


def resolve_spec(spec: str | None) -> str:
    """'default' / empty → the Settings embedding model."""
    return settings.get()["embedding_model"] if not spec or spec == "default" else spec


def resolve(spec: str | None) -> tuple[str, dict]:
    """Spec → (embedder component name, params)."""
    spec = resolve_spec(spec)
    prov, _, model = spec.partition(":")
    if not model:  # bare model name → local sentence-transformers
        return "sentence_transformers", {"model": spec}
    if prov not in PREFIX:
        if len(prov) == 1:  # Windows drive letter, e.g. C:\models\bge → local folder
            return "sentence_transformers", {"model": spec}
        raise ValueError(f"Unknown embedding provider '{prov}'. Use one of: {', '.join(PREFIX)}")
    return PREFIX[prov], {"model": model}


def make(spec: str | None):
    """Spec → (embedder instance, component name, params)."""
    name, params = resolve(spec)
    return create("embedder", name, params), name, params
