from pydantic import BaseModel, Field

from app.core.registry import Component, register
from app.core.types import Hit

from .rrf import merge_hit


def minmax(vals: dict[str, float]) -> dict[str, float]:
    if not vals:
        return {}
    lo, hi = min(vals.values()), max(vals.values())
    if hi - lo < 1e-12:
        return {k: 1.0 for k in vals}
    return {k: (v - lo) / (hi - lo) for k, v in vals.items()}


@register("fuser", "weighted", label="Weighted score (alpha)", order=2)
class WeightedFusion(Component):
    """fused = (1 - alpha) * norm(bm25) + alpha * norm(dense), each min-max normalised. alpha 0 = pure BM25, 1 = pure dense."""

    class Params(BaseModel):
        alpha: float = Field(0.5, ge=0.0, le=1.0, description="0 = pure BM25 · 1 = pure dense")

    def fuse(self, out):
        acc: dict[str, Hit] = {}
        for hits in out.lists.values():
            for h in hits:
                merge_hit(acc, h)
        nb = minmax({h.chunk_id: h.scores["bm25"] for h in out.lists.get("bm25", [])})
        nd = minmax({h.chunk_id: h.scores["dense"] for h in out.lists.get("dense", [])})
        a = self.p.alpha
        fused = {cid: (1 - a) * nb.get(cid, 0.0) + a * nd.get(cid, 0.0) for cid in acc}
        res = sorted(acc.values(), key=lambda h: -fused[h.chunk_id])
        for i, h in enumerate(res):
            h.scores["fused"] = round(fused[h.chunk_id], 6)
            h.ranks["fused"] = i + 1
        return res
