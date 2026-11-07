"""Cached BM25 indexes and chunk embeddings (shared by every pane)."""
from __future__ import annotations

import re

from .cache import cached_array, cached_memory, stable_hash
from .registry import create
from .types import ChunkSet

_WORD = re.compile(r"[A-Za-z0-9]+(?:['’][A-Za-z]+)?")
STOPWORDS = set(["a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "has", "have", "i", "if", "in", "into", "is", "it", "its", "of", "on", "or", "that", "the", "their", "then", "there", "these", "they", "this", "to", "was", "were", "will", "with", "what", "when", "which", "who", "how", "do", "does", "should", "can", "you", "your", "we", "our", "not", "no"])


def bm25_tokenize(text: str, remove_stopwords: bool = True) -> list[str]:
    toks = [t.lower() for t in _WORD.findall(text)]
    if remove_stopwords:
        toks = [t for t in toks if t not in STOPWORDS] or toks
    return toks


def bm25_index(cs: ChunkSet, variant: str, k1: float, b: float, remove_stopwords: bool):
    from rank_bm25 import BM25L, BM25Okapi, BM25Plus

    key = stable_hash(cs.key, variant, k1, b, remove_stopwords)

    def build():
        corpus = [bm25_tokenize(c.index_text, remove_stopwords) or ["_"] for c in cs.chunks]
        cls = {"okapi": BM25Okapi, "bm25l": BM25L, "bm25plus": BM25Plus}[variant]
        return cls(corpus, k1=k1, b=b)

    return cached_memory("bm25", key, build)


def chunk_embeddings(cs: ChunkSet, embedder_name: str, embedder_params: dict):
    emb = create("embedder", embedder_name, embedder_params)
    key = stable_hash(cs.key, emb.cache_id())

    def build():
        return emb.embed_documents([c.index_text for c in cs.chunks])

    vecs, hit = cached_array("emb", key, build)
    return emb, vecs, hit
