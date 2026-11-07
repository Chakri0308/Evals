import asyncio

from pydantic import BaseModel, Field

from app.components.retrievers._common import embedding_field
from app.core import embeddings
from app.core.indexes import chunk_embeddings
from app.core.registry import Component, create, register
from app.core.settings import Unavailable


@register("reranker", "mmr", label="MMR (diversity)", order=3)
class MMRReranker(Component):
    """Maximal Marginal Relevance: lambda * relevance - (1 - lambda) * similarity to chunks already picked. Reduces redundancy."""

    class Params(BaseModel):
        lambda_: float = Field(0.7, ge=0.0, le=1.0, alias="lambda", description="1 = pure relevance · 0 = pure diversity")
        rerank_top_n: int = Field(5, ge=1, le=50, description="Chunks kept")
        embedding_model: str = embedding_field()

        model_config = {"populate_by_name": True}

    async def rerank(self, question, hits, cs, ctx):
        if not hits:
            return hits, []
        name, params = embeddings.resolve(self.p.embedding_model)
        ok, why = create("embedder", name, params).ready()
        if not ok:
            raise Unavailable(f"MMR needs embeddings: {why}", what="embeddings")

        def run():
            emb, vecs, _ = chunk_embeddings(cs, name, params)
            idx = {c.id: i for i, c in enumerate(cs.chunks)}
            V = vecs[[idx[h.chunk_id] for h in hits]]
            q = emb.embed_query(question)
            rel = V @ q
            chosen, scores = [], {}
            remaining = list(range(len(hits)))
            lam = self.p.lambda_
            while remaining and len(chosen) < len(hits):
                best, best_s = None, -1e9
                for i in remaining:
                    red = max((float(V[i] @ V[j]) for j in chosen), default=0.0)
                    s = lam * float(rel[i]) - (1 - lam) * red
                    if s > best_s:
                        best, best_s = i, s
                chosen.append(best)
                remaining.remove(best)
                scores[best] = best_s
            return chosen, scores

        order, scores = await asyncio.to_thread(run)
        ranked = [hits[i] for i in order]
        for r, i in enumerate(order):
            hits[i].scores["rerank"] = round(scores[i], 4)
            hits[i].ranks["rerank"] = r + 1
        n = self.p.rerank_top_n
        for h in ranked[n:]:
            h.dropped_by, h.drop_reason = "rerank", f"MMR rank #{h.ranks['rerank']} > top_n {n}"
        return ranked[:n], ranked[n:]
