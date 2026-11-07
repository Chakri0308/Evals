"""Test helpers shared across test modules (fixtures live in conftest.py)."""
import asyncio

from app.core.registry import create
from app.core.types import ChunkSet


class Ctx:
    """Minimal stand-in for the pipeline's per-run context."""

    def __init__(self, doc, tok):
        self.doc, self.tokenizer, self.trace = doc, tok, {}


def chunkset(doc, tok):
    ch = create("chunker", "heading_aware", {"chunk_size_tokens": 256, "overlap_tokens": 0})
    from app.core.cache import stable_hash

    chunks = ch.chunk(doc, Ctx(doc, tok))
    return ChunkSet(key="t-" + stable_hash([c.index_text for c in chunks]), doc_id=doc.id, chunks=chunks)


def pipe(retriever, **over):
    from app.core.pipeline import PipelineConfig, StageConfig

    stages = {
        "query_transform": StageConfig(enabled=False, component="multi_query"),
        "chunking": StageConfig(component="heading_aware", params={"chunk_size_tokens": 256, "overlap_tokens": 32}),
        "retrieval": StageConfig(component=retriever, params={"top_k": 5}),
        "fusion": StageConfig(enabled=retriever == "hybrid", component="rrf"),
        "rerank": StageConfig(enabled=False, component="cross_encoder"),
        "context_filter": StageConfig(component="standard"),
        "prompt": StageConfig(component="template"),
        "generation": StageConfig(component="ollama", params={"model": "qwen2.5:1.5b"}),
    }
    stages.update(over)
    return PipelineConfig(id="A", name=retriever, stages=stages)


def run(doc, cfg, q):
    from app.core.pipeline import run_pipeline

    events = []

    async def emit(ev, d):
        events.append((ev, d))

    return asyncio.run(run_pipeline(doc, cfg, q, emit)), events
