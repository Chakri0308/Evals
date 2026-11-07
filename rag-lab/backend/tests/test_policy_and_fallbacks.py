"""Providers, access policy (no-LLM / no-embeddings), fallbacks, pre-flight reports, settings."""
import asyncio

import pytest

from app.core.registry import create

from .helpers import pipe as _pipe
from .helpers import run as _run


# ------------------------------------------------------------- providers, policy, fallbacks
def test_no_llm_mode_bm25_still_answers(doc, monkeypatch):
    """Office mode: no LLM call is ever made, yet BM25 retrieves and an extractive answer is produced."""
    from app.components.llms import ollama_llm
    from app.core.pipeline import StageConfig

    monkeypatch.setenv("RAG_LAB_ALLOW_LLM", "false")
    calls = []
    monkeypatch.setattr(ollama_llm.httpx, "AsyncClient", lambda *a, **k: calls.append(1))  # would explode if used
    cfg = _pipe("bm25", query_transform=StageConfig(enabled=True, component="multi_query"))
    res, events = _run(doc, cfg, "Which code name must never appear in public docs?")
    assert not calls
    assert "error" not in res, res.get("error")
    assert res["answer_source"]["kind"] == "extractive_fallback"
    assert "Halcyon" in res["answer"] and res["cited"]
    assert res["status"]["query_transform"] == "skipped"  # LLM query rewrite fell back to the raw question
    assert any(n["stage"] == "generation" for n in res["notices"])


def test_llm_policy_guard_blocks_direct_calls(monkeypatch):
    from app.core.settings import Unavailable

    monkeypatch.setenv("RAG_LAB_ALLOW_LLM", "false")
    for prov in ("ollama", "openai", "anthropic", "gemini"):
        llm = create("llm", prov, {})
        assert llm.ready()[0] is False
        with pytest.raises(Unavailable):
            asyncio.run(llm.complete("s", "u"))
    assert create("llm", "extractive", {}).ready()[0]  # the no-model answerer is always allowed


@pytest.mark.parametrize("retriever", ["dense", "hybrid"])
def test_semantic_and_hybrid_report_not_ready(doc, monkeypatch, retriever):
    """No embeddings allowed: the pane checks what it can, reports what's missing, and does not crash."""
    from app.core import vectorstore

    monkeypatch.setenv("RAG_LAB_ALLOW_EMBEDDINGS", "false")
    monkeypatch.setenv("RAG_LAB_ALLOW_LLM", "false")
    vectorstore.forget()
    res, events = _run(doc, _pipe(retriever), "Can I use contractions?")
    nr = res["not_ready"]
    assert "error" not in res and res["answer"] == ""
    assert nr["missing"] == ["embedder"]
    states = {c["id"]: c["state"] for c in nr["checks"]}
    assert states["chunks"] == "ok" and states["vector_db"] == "ok" and states["embedder"] == "missing"
    assert states["llm"] == "fallback"
    if retriever == "hybrid":
        assert states["bm25"] == "ok"
    assert nr["quip"] and "embedding model" in nr["headline"]
    ends = {d["stage"]: d["status"] for ev, d in events if ev == "stage_end"}
    assert ends["retrieval"] == "not_ready" and ends["generation"] == "skipped"


def test_not_ready_reports_missing_vector_db(doc, monkeypatch):
    from app.core import vectorstore

    monkeypatch.delenv("PGVECTOR_DSN", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    vectorstore.forget()
    cfg = _pipe("dense")
    cfg.stages["retrieval"].params["vector_store"] = "pgvector"
    res, _ = _run(doc, cfg, "Can I use contractions?")
    nr = res["not_ready"]
    assert nr["missing"] == ["vector_db"]
    vdb = next(c for c in nr["checks"] if c["id"] == "vector_db")
    assert "PGVECTOR_DSN" in vdb["detail"] and vdb["fix"]


def test_unconfigured_providers_explain_themselves(monkeypatch):
    for k in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_KEY",
              "OPENAI_COMPATIBLE_BASE_URL", "PINECONE_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    assert "GEMINI_API_KEY" in create("llm", "gemini", {}).ready()[1]
    assert "AZURE_OPENAI" in create("llm", "azure_openai", {}).ready()[1]
    assert "OPENAI_COMPATIBLE_BASE_URL" in create("llm", "openai_compatible", {}).ready()[1]
    assert "PINECONE_API_KEY" in create("vector_store", "pinecone", {}).available()[1]


def test_settings_switch_defaults_and_env_locks(monkeypatch):
    from app.core import settings
    from app.core.providers import make_llm, resolve_llm

    settings.update({"llm_provider": "gemini", "llm_model": "gemini-2.5-pro", "vector_store": "faiss"})
    try:
        assert resolve_llm(None, None) == ("gemini", "gemini-2.5-pro")
        assert make_llm().p.model == "gemini-2.5-pro"
        assert resolve_llm("anthropic", None) == ("anthropic", "claude-haiku-5-5")
        from app.core import vectorstore

        assert vectorstore.resolve("default") == "faiss"
    finally:
        settings.update({"llm_provider": "ollama", "llm_model": "", "vector_store": "chroma"})
    monkeypatch.setenv("RAG_LAB_ALLOW_LLM", "false")
    assert settings.get()["allow_llm"] is False
    with pytest.raises(PermissionError):
        settings.update({"allow_llm": True})
    monkeypatch.setenv("RAG_LAB_OFFLINE", "true")
    assert settings.locks().keys() == {"allow_llm", "allow_embeddings"}
