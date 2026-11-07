from pydantic import BaseModel, Field

from app.core.registry import Component, register
from app.core.types import Hit


def merge_hit(dst: dict[str, Hit], h: Hit) -> Hit:
    cur = dst.get(h.chunk_id)
    if cur is None:
        cur = Hit(chunk_id=h.chunk_id)
        dst[h.chunk_id] = cur
    cur.scores.update(h.scores)
    cur.ranks.update(h.ranks)
    return cur


@register("fuser", "rrf", label="Reciprocal Rank Fusion", order=1)
class RRF(Component):
    """score = sum 1/(k + rank) over the lists. Uses ranks only, so it needs no score normalisation."""

    class Params(BaseModel):
        k: int = Field(60, ge=1, le=200, description="RRF damping constant")

    def fuse(self, out):
        acc: dict[str, Hit] = {}
        fused: dict[str, float] = {}
        for hits in out.lists.values():
            for r, h in enumerate(hits, start=1):
                merge_hit(acc, h)
                fused[h.chunk_id] = fused.get(h.chunk_id, 0.0) + 1.0 / (self.p.k + r)
        res = sorted(acc.values(), key=lambda h: -fused[h.chunk_id])
        for i, h in enumerate(res):
            h.scores["fused"] = round(fused[h.chunk_id], 6)
            h.ranks["fused"] = i + 1
        return res
