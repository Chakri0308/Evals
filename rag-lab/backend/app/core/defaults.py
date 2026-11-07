"""The three default panes (BM25 / Semantic / Hybrid). Generation follows the Settings default LLM."""
from __future__ import annotations

from .pipeline import PipelineConfig, StageConfig
from .providers import resolve_llm
from .registry import get_spec

DEFAULT_CHUNKING = {"component": "heading_aware", "params": {"chunk_size_tokens": 256, "overlap_tokens": 32}}


def _generation() -> StageConfig:
    prov, model = resolve_llm(None, None)
    has_model = "model" in get_spec("llm", prov).params_model.model_fields
    return StageConfig(component=prov, params={"model": model} if model and has_model else {})


def default_pipeline(pid: str, name: str, color: str, retriever: str) -> dict:
    return PipelineConfig(id=pid, name=name, color=color, stages={
        "query_transform": StageConfig(enabled=False, component="multi_query"),
        "chunking": StageConfig(**DEFAULT_CHUNKING),
        "retrieval": StageConfig(component=retriever, params={"top_k": 5}),
        "fusion": StageConfig(enabled=retriever == "hybrid", component="rrf"),
        # semantic: cross-encoder rerank on (paraphrased-question hit@1 0.87 → 0.90, MRR 0.91 → 0.95)
        "rerank": StageConfig(enabled=retriever == "dense", component="cross_encoder"),
        "context_filter": StageConfig(component="standard"),
        "prompt": StageConfig(component="template"),
        "generation": _generation(),
    }).model_dump()


def default_panes() -> list[dict]:
    return [
        default_pipeline("A", "BM25", "indigo", "bm25"),
        default_pipeline("B", "Semantic", "emerald", "dense"),
        default_pipeline("C", "Hybrid RRF", "amber", "hybrid"),
    ]
