import asyncio

from pydantic import BaseModel, Field

from app.core.registry import Component, register
from app.core.types import RetrievalOutput

from ._common import BM25Variant, bm25_search, dense_search, embedding_field, vector_store_field


@register("retriever", "hybrid", label="Hybrid (BM25 + dense)", order=3)
class HybridRetriever(Component):
    """Runs BM25 and dense search together. The Fusion stage merges the two ranked lists."""

    class Params(BaseModel):
        top_k: int = Field(5, ge=1, le=50, description="Chunks kept after fusion")
        bm25_candidate_k: int = Field(20, ge=1, le=200, description="Candidates from BM25")
        dense_candidate_k: int = Field(20, ge=1, le=200, description="Candidates from dense search")
        variant: BM25Variant = Field("okapi", description="BM25 variant")
        k1: float = Field(1.5, ge=0.0, le=3.0, description="BM25 term-frequency saturation")
        b: float = Field(0.75, ge=0.0, le=1.0, description="BM25 length normalisation")
        remove_stopwords: bool = Field(True, description="Drop stopwords for BM25")
        embedding_model: str = embedding_field()
        similarity_threshold: float = Field(0.0, ge=0.0, le=1.0, description="Dense cosine cutoff")
        vector_store: str = vector_store_field()

    async def retrieve(self, qb, cs, ctx):
        p = self.p
        bm = asyncio.to_thread(bm25_search, qb.queries, cs, p.bm25_candidate_k, p.variant, p.k1, p.b,
                               p.remove_stopwords)
        de = dense_search(qb.dense_queries, cs, p.dense_candidate_k, p.embedding_model, p.similarity_threshold,
                          p.vector_store, ctx, "hybrid")
        (bh, bc), (dh, dc) = await asyncio.gather(bm, de)
        ctx.trace["index_cache"] = {"bm25": bc, "embeddings": dc["cached"]}
        ctx.trace["vector_store"] = dc
        return RetrievalOutput(lists={"bm25": bh, "dense": dh})
