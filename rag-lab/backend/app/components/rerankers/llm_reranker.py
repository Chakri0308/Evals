import asyncio
import re

from pydantic import BaseModel, Field

from app.core.registry import Component, register
from app.core.settings import Unavailable

from .cross_encoder import apply_rerank


@register("reranker", "llm", label="LLM reranker", order=2)
class LLMReranker(Component):
    """The pane's LLM rates each chunk's relevance from 0 to 10 (pointwise)."""

    class Params(BaseModel):
        rerank_top_n: int = Field(5, ge=1, le=50, description="Chunks kept after reranking")
        max_candidates: int = Field(10, ge=1, le=30, description="Only the top-N candidates are sent to the LLM")

    async def rerank(self, question, hits, cs, ctx):
        by = cs.by_id()
        cand, rest = hits[: self.p.max_candidates], hits[self.p.max_candidates:]
        llm = ctx.llm_factory()
        ok, why = llm.ready()
        if not ok:
            raise Unavailable(f"LLM reranker skipped: {why}", what="llm")

        async def score(h):
            txt = by[h.chunk_id].text[:1500]
            out = await llm.complete(
                "Rate how useful the passage is for answering the question, from 0 (irrelevant) to 10 "
                "(directly answers it). Reply with the number only.",
                f"Question: {question}\n\nPassage:\n{txt}\n\nScore:")
            m = re.search(r"\d+(?:\.\d+)?", out)
            return min(10.0, float(m.group())) if m else 0.0

        scores = await asyncio.gather(*(score(h) for h in cand))
        kept, dropped = apply_rerank(cand, scores, self.p.rerank_top_n)
        for h in rest:
            h.dropped_by, h.drop_reason = "rerank", "beyond max_candidates"
        ctx.trace["llm_usage"] = llm.usage.model_dump()
        return kept, dropped + rest
