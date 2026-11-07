from __future__ import annotations

import asyncio
from typing import Literal

import numpy as np
from pydantic import Field

from app.core import embeddings
from app.core.indexes import bm25_index, bm25_tokenize, chunk_embeddings
from app.core.types import ChunkSet, Hit

BM25Variant = Literal["okapi", "bm25l", "bm25plus"]


def embedding_field(desc: str = "Embedding model (provider:model), or 'default' to use Settings"):
    return Field("default", description=desc, json_schema_extra={"x-suggest": "embedding_models"})


def vector_store_field():
    return Field("default", description="Vector database for the chunk vectors, or 'default' to use Settings",
                 json_schema_extra={"x-options": "vector_stores"})


def _merge_max(per_query: list[list[Hit]], key: str) -> list[Hit]:
    best: dict[str, Hit] = {}
    for hits in per_query:
        for h in hits:
            if h.chunk_id not in best or h.scores[key] > best[h.chunk_id].scores[key]:
                best[h.chunk_id] = h
    out = sorted(best.values(), key=lambda h: -h.scores[key])
    for i, h in enumerate(out):
        h.ranks[key] = i + 1
    return out


def bm25_search(queries: list[str], cs: ChunkSet, k: int, variant: str, k1: float, b: float,
                remove_stopwords: bool) -> tuple[list[Hit], bool]:
    idx, hit = bm25_index(cs, variant, k1, b, remove_stopwords)
    per_q = []
    for q in queries:
        scores = idx.get_scores(bm25_tokenize(q, remove_stopwords))
        order = np.argsort(-scores)[:k]
        per_q.append([Hit(chunk_id=cs.chunks[i].id, scores={"bm25": float(scores[i])}) for i in order
                      if scores[i] > 0])
    return _merge_max(per_q, "bm25"), hit


async def dense_search(queries: list[str], cs: ChunkSet, k: int, embedding_model: str, threshold: float,
                       vector_store: str = "default", ctx=None, retriever: str = "dense") -> tuple[list[Hit], dict]:
    """Embed each query and fetch the k nearest chunks from the selected vector store.

    Readiness is checked first (vector DB connection, embedding model allowed/present). If something is
    missing, raises ``NotReady`` with a full report instead of failing half-way.
    """
    from app.core import readiness, vectorstore

    spec = embeddings.resolve_spec(embedding_model)
    store_name = vectorstore.resolve(vector_store)

    def run():
        emb, name, params, bad = None, None, None, ""
        try:
            emb, name, params = embeddings.make(spec)
        except Exception as e:  # noqa: BLE001
            bad = str(e)
        report = readiness.dense_report(cs, retriever, spec, emb, store_name, ctx)
        if emb is None:
            report["checks"] = [c if c["id"] != "embedder" else {**c, "detail": bad} for c in report["checks"]]
        if not report["ready"]:
            raise readiness.NotReady(report)
        try:
            col, hit = vectorstore.ensure(store_name, cs, emb, lambda: chunk_embeddings(cs, name, params)[1])
            per_q = [[Hit(chunk_id=cid, scores={"dense": s})
                      for cid, s in vectorstore.search(store_name, col, emb.embed_query(q), k) if s >= threshold]
                     for q in queries]
        except readiness.Unavailable:
            raise
        except Exception:
            vectorstore.forget(store_name)  # connection dropped mid-way: re-check next time
            raise
        info = {"vector_store": store_name, "collection": col, "vectors": len(cs.chunks), "cached": hit,
                "embedding_model": spec, "checks": report["checks"]}
        return _merge_max(per_q, "dense"), info

    return await asyncio.to_thread(run)
