"""Readiness checks for semantic / hybrid retrieval, and the friendly "almost there" report.

When an embedding model or vector DB is missing (or blocked by policy), a semantic/hybrid pane does not
crash: it runs every check it can (document chunked? BM25 index? vector DB reachable? embedding model
allowed and present? answer LLM?) and reports what is fine and the one or two things still missing.
"""
from __future__ import annotations

import hashlib
from typing import Any, Optional

from . import settings
from .settings import Unavailable


class NotReady(Unavailable):
    def __init__(self, report: dict):
        super().__init__(report["headline"], what="retrieval")
        self.report = report


def _check(id_: str, label: str, state: str, detail: str = "", fix: str = "") -> dict:
    # state: ok | missing | pending | fallback | info
    return {"id": id_, "label": label, "state": state, "detail": detail, "fix": fix}


QUIPS = {
    "embedder": [
        "All the pipes are connected and the water's on. I'm just missing the tap. Plug in an embedding model and I'll start pouring answers.",
        "The library is open and the shelves are stocked, but my reading glasses are missing. Hand me an embedding model and I'll find anything.",
        "Engine checked, tyres checked, fuel checked… keys? Somewhere. Give me an embedding model and we're off.",
        "I can see the vector database from here and it waved back. I just need an embedding model to say something meaningful to it.",
    ],
    "vector_db": [
        "I've got my reading glasses on, but nowhere to shelve the books. Connect a vector database and I'm in business.",
        "Embeddings: ready. Filing cabinet: nowhere to be found. Point me at a vector DB and I'll get organised.",
        "I know exactly what every chunk means. I just don't have a place to keep it yet. A vector DB, please?",
    ],
    "both": [
        "Stage is built, lights are rigged, and the band hasn't arrived yet. Bring an embedding model and a vector DB, and it's showtime.",
        "Everything that can be ready is ready. The rest is on its way, like a pizza with two toppings still in the oven.",
    ],
}


def _quip(missing: set[str], seed: str) -> str:
    key = "both" if {"embedder", "vector_db"} <= missing else ("vector_db" if "vector_db" in missing else "embedder")
    opts = QUIPS[key]
    return opts[int(hashlib.md5(seed.encode()).hexdigest(), 16) % len(opts)]


def _emb_fix(reason: str, spec: str) -> str:
    lk = settings.locks().get("allow_embeddings")
    if reason == settings.POLICY_EMB:
        return (f"Locked by {lk}. Ask for an approved embedding model, then set it to true." if lk else
                "Turn on 'Embedding / reranker models' in ⚙ Settings (or RAG_LAB_ALLOW_EMBEDDINGS=true in .env).")
    if "API_KEY" in reason:
        return f"Add the key to rag-lab/.env and restart the backend, or pick another embedding model than {spec}."
    if "not downloaded" in reason or "unreachable" in reason:
        return "Copy the model folder onto this machine and set EMBEDDING_MODEL=local:<folder path> in .env."
    if "ollama" in reason.lower():
        return reason
    return "Pick another embedding model in ⚙ Settings or on this pane's Retrieve stage."


def dense_report(cs, retriever: str, emb_spec: str, emb, store_name: str, ctx: Optional[Any] = None) -> dict:
    """Run every readiness check for a semantic/hybrid pane. ``report['ready']`` is False if something blocks."""
    from . import vectorstore
    from .registry import get_spec

    checks = [_check("chunks", "Document chunked", "ok", f"{len(cs.chunks)} chunks ready")]
    if retriever == "hybrid":
        checks.append(_check("bm25", "BM25 keyword index", "ok", "ready (no model needed)"))

    missing: set[str] = set()
    try:
        label = get_spec("vector_store", store_name).label
    except KeyError:
        label = store_name
    v_ok, v_why = vectorstore.check(store_name)
    if v_ok:
        checks.append(_check("vector_db", f"Vector DB · {label}", "ok", v_why or "connected"))
    else:
        missing.add("vector_db")
        needs = getattr(vectorstore.store(store_name), "needs", "") if store_name in vectorstore.names() else ""
        checks.append(_check("vector_db", f"Vector DB · {label}", "missing", v_why,
                             needs or "Choose another vector store in ⚙ Settings."))

    e_ok, e_why = emb.ready() if emb is not None else (False, "unknown embedding model")
    if e_ok:
        checks.append(_check("embedder", f"Embedding model · {emb_spec}", "ok", e_why or "available"))
    else:
        missing.add("embedder")
        checks.append(_check("embedder", f"Embedding model · {emb_spec}", "missing", e_why, _emb_fix(e_why, emb_spec)))

    if v_ok and emb is not None:
        n = vectorstore.indexed_count(store_name, cs, emb)
        if n == len(cs.chunks):
            checks.append(_check("vectors", "Vectors for these chunks", "ok", f"{n} stored in {label}"))
        else:
            checks.append(_check("vectors", "Vectors for these chunks", "pending",
                                 "built automatically on the first run once the embedding model is available"
                                 if not e_ok else "will be built on this run"))

    if ctx is not None and getattr(ctx, "llm_factory", None):
        try:
            llm = ctx.llm_factory()
            l_ok, l_why = llm.ready()
            name = f"{llm.component_name} · {llm.model_name}"
            checks.append(_check("llm", f"Answer LLM · {name}", "ok" if l_ok else "fallback",
                                 "ready" if l_ok else f"{l_why}. BM25-style extractive answers are used instead."))
        except Exception as e:  # noqa: BLE001
            checks.append(_check("llm", "Answer LLM", "fallback", str(e)))

    ready = not missing
    what = " and ".join({"embedder": "an embedding model", "vector_db": "a vector database"}[m] for m in sorted(missing))
    headline = ("All systems go" if ready else
                f"{'Hybrid' if retriever == 'hybrid' else 'Semantic'} search is plugged in and waiting for {what}")
    return {"ready": ready, "retriever": retriever, "missing": sorted(missing), "checks": checks,
            "headline": headline, "quip": "" if ready else _quip(missing, cs.key + retriever),
            "ok_count": sum(c["state"] == "ok" for c in checks), "total": len(checks)}
