"""Backend-agnostic vector index layer.

Retrievers ask for "the vectors of this chunk set, embedded with this model, in store X". This module builds
the collection once (embeddings come from the .npy cache when possible), reuses it afterwards, and queries it.
The concrete database is a registered ``vector_store`` component (chroma, faiss, pgvector, pinecone,
in_memory, ...), chosen per retriever or globally in Settings.
"""
from __future__ import annotations

import threading
import time
from collections.abc import Callable
from typing import Any

import numpy as np

from . import settings
from .cache import stable_hash
from .registry import all_specs, create, get_spec
from .types import ChunkSet

_stores: dict[str, Any] = {}
_ready: set[tuple[str, str]] = set()  # (store, collection) known complete
_locks: dict[tuple[str, str], threading.Lock] = {}
_glock = threading.Lock()
_avail: dict[str, tuple[float, bool, str]] = {}
AVAIL_TTL = 20.0


def resolve(name: str | None) -> str:
    return settings.get()["vector_store"] if not name or name == "default" else name


def names() -> list[str]:
    return [s.name for s in all_specs()["vector_store"]]


def store(name: str):
    name = resolve(name)
    with _glock:
        if name not in _stores:
            get_spec("vector_store", name)  # raises a clear KeyError for unknown names
            _stores[name] = create("vector_store", name, {})
        return _stores[name]


def check(name: str, fresh: bool = False) -> tuple[bool, str]:
    """Cached connection check (real network/disk check at most every AVAIL_TTL seconds)."""
    name = resolve(name)
    now = time.time()
    hit = _avail.get(name)
    if hit and not fresh and now - hit[0] < AVAIL_TTL:
        return hit[1], hit[2]
    try:
        ok, why = store(name).available()
    except Exception as e:  # noqa: BLE001
        ok, why = False, f"{type(e).__name__}: {e}"
    _avail[name] = (now, ok, why)
    return ok, why


def collection_name(cs: ChunkSet, embedder_cache_id: dict) -> str:
    return "rag_" + stable_hash(cs.key, embedder_cache_id)[:32]


def _meta(cs: ChunkSet, c) -> dict:
    md = {"doc_id": cs.doc_id, "chunk_id": c.id, "index": c.index, "start": c.start, "end": c.end,
          "tokens": c.tokens, "heading": " > ".join(c.heading_path)}
    if c.page is not None:
        md["page"] = c.page
    return md


def indexed_count(store_name: str, cs: ChunkSet, emb) -> int:
    try:
        return store(store_name).count(collection_name(cs, emb.cache_id()))
    except Exception:  # noqa: BLE001
        return 0


def ensure(store_name: str, cs: ChunkSet, emb, compute_vectors: Callable[[], np.ndarray]) -> tuple[str, bool]:
    """Make sure the collection for (chunk set, embedder) exists and is complete. Returns (name, was_cached)."""
    store_name = resolve(store_name)
    name = collection_name(cs, emb.cache_id())
    key = (store_name, name)
    if key in _ready:
        return name, True
    with _glock:
        lock = _locks.setdefault(key, threading.Lock())
    with lock:
        if key in _ready:
            return name, True
        st = store(store_name)
        n = len(cs.chunks)
        cached = st.count(name) == n
        if not cached:
            st.reset(name)  # partial/stale build → start clean
            vecs = np.asarray(compute_vectors(), dtype=np.float32)
            st.upsert(name, [c.id for c in cs.chunks], vecs, [c.index_text for c in cs.chunks],
                      [_meta(cs, c) for c in cs.chunks])
        _ready.add(key)
        return name, cached


def search(store_name: str, name: str, qvec: np.ndarray, k: int) -> list[tuple[str, float]]:
    return store(store_name).query(name, qvec, k)


def stats() -> list[dict]:
    out = []
    for n in names():
        ok, why = check(n)
        row = {"store": n, "label": get_spec("vector_store", n).label, "ok": ok, "detail": why,
               "location": "", "collections": []}
        if ok:
            try:
                st = store(n)
                row["location"] = st.location()
                row["collections"] = st.collections()
            except Exception as e:  # noqa: BLE001
                row["detail"] = f"{why} (listing failed: {e})"
        out.append(row)
    return out


def forget(store_name: str | None = None) -> None:
    """Drop in-process caches (after a settings change or a failed connection)."""
    with _glock:
        if store_name is None:
            _ready.clear()
            _avail.clear()
        else:
            for k in [k for k in _ready if k[0] == store_name]:
                _ready.discard(k)
            _avail.pop(store_name, None)
