"""Startup work: ingest the sample guide, then (in the background) warm local models and index the sample
into the default vector store, as far as the access policy allows."""
from __future__ import annotations

import logging
import threading

from app import config
from app.core import embeddings, models, settings, vectorstore
from app.core.defaults import DEFAULT_CHUNKING
from app.core.documents import get_chunkset, parse_upload
from app.core.indexes import chunk_embeddings
from app.core.types import Document

log = logging.getLogger("rag_lab.startup")
RERANKER = "cross-encoder/ms-marco-MiniLM-L-6-v2"


def ingest_sample() -> Document | None:
    if not config.SAMPLE_DOC.exists():
        return None
    try:
        doc, _ = parse_upload(config.SAMPLE_DOC.read_bytes(), config.SAMPLE_DOC.name)
        return doc
    except Exception:  # noqa: BLE001
        log.exception("sample ingest failed")
        return None


def warm_up(sample: Document | None) -> None:
    s = settings.get()
    log.info("mode: llm=%s embeddings=%s · llm=%s · vector_store=%s · embedding=%s",
             "on" if s["allow_llm"] else "OFF", "on" if s["allow_embeddings"] else "OFF",
             s["llm_provider"], s["vector_store"], s["embedding_model"])
    if not s["allow_embeddings"]:
        log.info("embeddings switched off: skipping warm-up (BM25 + extractive answers still work)")
        return
    try:
        emb, name, params = embeddings.make(s["embedding_model"])
        ok, why = emb.ready()
        if not ok:
            log.warning("embedding model not available: %s", why)
            return
        emb.embed_query("warm up")
        if models.status(RERANKER)[0]:
            models.load("cross_encoder", RERANKER)
        v_ok, v_why = vectorstore.check(s["vector_store"])
        if not v_ok:
            log.warning("vector store '%s' not reachable: %s", s["vector_store"], v_why)
        elif sample is not None:
            cs, _ = get_chunkset(sample, DEFAULT_CHUNKING["component"], DEFAULT_CHUNKING["params"])
            col, _ = vectorstore.ensure(s["vector_store"], cs, emb, lambda: chunk_embeddings(cs, name, params)[1])
            log.info("%s collection %s: %d vectors", s["vector_store"], col, len(cs.chunks))
        log.info("models warm")
    except Exception:  # noqa: BLE001
        log.exception("model warm-up failed")


def run() -> None:
    sample = ingest_sample()
    if config.WARMUP:
        threading.Thread(target=warm_up, args=(sample,), name="warm-up", daemon=True).start()
