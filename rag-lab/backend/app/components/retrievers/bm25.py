from pydantic import BaseModel, Field

from app.core.registry import Component, register
from app.core.types import RetrievalOutput

from ._common import BM25Variant, bm25_search


@register("retriever", "bm25", label="BM25 only", order=1)
class BM25Retriever(Component):
    """Keyword search with rank_bm25. Good at exact terms, codes and rare words; weak on paraphrases."""

    class Params(BaseModel):
        top_k: int = Field(5, ge=1, le=50, description="Chunks kept after retrieval/fusion")
        candidate_k: int = Field(20, ge=1, le=200, description="Candidates fetched from BM25")
        variant: BM25Variant = Field("okapi", description="BM25 variant")
        k1: float = Field(1.5, ge=0.0, le=3.0, description="Term-frequency saturation")
        b: float = Field(0.75, ge=0.0, le=1.0, description="Length normalisation")
        remove_stopwords: bool = Field(True, description="Drop English stopwords before scoring")

    async def retrieve(self, qb, cs, ctx):
        p = self.p
        hits, cached = bm25_search(qb.queries, cs, p.candidate_k, p.variant, p.k1, p.b, p.remove_stopwords)
        ctx.trace["index_cache"] = {"bm25": cached}
        return RetrievalOutput(lists={"bm25": hits})
