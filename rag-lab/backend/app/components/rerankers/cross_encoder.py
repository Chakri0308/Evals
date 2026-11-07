import asyncio
from typing import Literal

from pydantic import BaseModel, Field

from app.core import models, settings
from app.core.registry import Component, register


def apply_rerank(hits, scores, top_n):
    for h, s in zip(hits, scores):
        h.scores["rerank"] = round(float(s), 4)
    ranked = sorted(hits, key=lambda h: -h.scores["rerank"])
    for i, h in enumerate(ranked):
        h.ranks["rerank"] = i + 1
    kept = ranked[:top_n]
    for h in ranked[top_n:]:
        h.dropped_by, h.drop_reason = "rerank", f"rerank rank #{h.ranks['rerank']} > top_n {top_n}"
    return kept, ranked[top_n:]


@register("reranker", "none", label="None", order=0)
class NoRerank(Component):
    """Keeps the retrieval order."""

    async def rerank(self, question, hits, cs, ctx):
        return hits, []


@register("reranker", "cross_encoder", label="Cross-encoder", order=1)
class CrossEncoderReranker(Component):
    """Scores each (question, chunk) pair jointly with a cross-encoder. Slower, but much more precise than bi-encoder similarity."""

    class Params(BaseModel):
        model: Literal["cross-encoder/ms-marco-MiniLM-L-6-v2", "BAAI/bge-reranker-base"] = Field(
            "cross-encoder/ms-marco-MiniLM-L-6-v2", description="Cross-encoder model")
        rerank_top_n: int = Field(5, ge=1, le=50, description="Chunks kept after reranking")

    async def rerank(self, question, hits, cs, ctx):
        if not hits:
            return hits, []
        if not settings.embeddings_allowed():
            raise settings.Unavailable(f"cross-encoder skipped: {settings.POLICY_EMB}", what="embeddings")
        if not models.is_loaded("cross_encoder", self.p.model):
            ok, why = await asyncio.to_thread(models.status, self.p.model)
            if not ok:
                raise settings.Unavailable(f"cross-encoder skipped: {why}", what="embeddings")
        by = cs.by_id()
        m = await asyncio.to_thread(models.load, "cross_encoder", self.p.model)
        scores = await asyncio.to_thread(m.predict, [(question, by[h.chunk_id].index_text) for h in hits])
        return apply_rerank(hits, scores, self.p.rerank_top_n)
