from pydantic import BaseModel, Field

from app.core.registry import Component, register
from app.core.types import RetrievalOutput

from ._common import dense_search, embedding_field, vector_store_field


@register("retriever", "dense", label="Semantic (dense) only", order=2)
class DenseRetriever(Component):
    """Embedding search with cosine similarity. Handles paraphrase and synonyms; can miss exact rare terms."""

    class Params(BaseModel):
        top_k: int = Field(5, ge=1, le=50, description="Chunks kept after retrieval/fusion")
        candidate_k: int = Field(20, ge=1, le=200, description="Candidates fetched from the vector index")
        embedding_model: str = embedding_field()
        similarity_threshold: float = Field(0.0, ge=0.0, le=1.0, description="Drop candidates below this cosine")
        vector_store: str = vector_store_field()

    async def retrieve(self, qb, cs, ctx):
        p = self.p
        hits, info = await dense_search(qb.dense_queries, cs, p.candidate_k, p.embedding_model,
                                        p.similarity_threshold, p.vector_store, ctx, "dense")
        ctx.trace["index_cache"] = {"embeddings": info["cached"]}
        ctx.trace["vector_store"] = info
        return RetrievalOutput(lists={"dense": hits})
