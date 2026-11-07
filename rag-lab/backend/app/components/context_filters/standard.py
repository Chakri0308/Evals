from typing import Literal

from pydantic import BaseModel, Field

from app.core.indexes import bm25_tokenize
from app.core.registry import Component, register
from app.core.types import Hit


def _jaccard(a: str, b: str) -> float:
    sa, sb = set(bm25_tokenize(a, False)), set(bm25_tokenize(b, False))
    return len(sa & sb) / (len(sa | sb) or 1)


@register("context_filter", "standard", label="Filter chain", order=1)
class StandardFilter(Component):
    """In order: score threshold, near-duplicate removal, neighbour expansion, merging adjacent chunks, token budget."""

    class Params(BaseModel):
        score_threshold: float = Field(0.0, ge=0.0, le=1.0, description="Drop hits whose best normalised score is below this")
        threshold_on: Literal["auto", "rerank", "fused", "dense", "bm25"] = Field("auto", description="Score used for the threshold")
        dedupe: bool = Field(True, description="Remove near-duplicate chunks")
        dedupe_jaccard: float = Field(0.85, ge=0.5, le=1.0, description="Word-Jaccard at or above this counts as a duplicate")
        expand_neighbors: int = Field(0, ge=0, le=3, description="Also include ±N neighbouring chunks")
        merge_adjacent: bool = Field(False, description="Merge chunks that are next to each other in the document")
        max_context_tokens: int = Field(3000, ge=128, le=32000, description="Token budget for the whole context")

    def filter(self, hits, cs, ctx):
        p = self.p
        by = cs.by_id()
        kept, dropped = list(hits), []

        # 1. score threshold (min-max normalised within the list)
        if p.score_threshold > 0 and kept:
            key = p.threshold_on
            if key == "auto":
                key = next((k for k in ("rerank", "fused", "dense", "bm25") if k in kept[0].scores), None)
            vals = [h.scores.get(key, 0.0) for h in kept]
            lo, hi = min(vals), max(vals)
            nxt = []
            for h, v in zip(kept, vals):
                nv = 1.0 if hi - lo < 1e-12 else (v - lo) / (hi - lo)
                if nv < p.score_threshold:
                    h.dropped_by, h.drop_reason = "context_filter", f"{key} normalised {nv:.2f} < {p.score_threshold}"
                    dropped.append(h)
                else:
                    nxt.append(h)
            kept = nxt

        # 2. dedupe
        if p.dedupe:
            nxt = []
            for h in kept:
                dup = next((k for k in nxt if _jaccard(by[k.chunk_id].text, by[h.chunk_id].text) >= p.dedupe_jaccard), None)
                if dup:
                    h.dropped_by, h.drop_reason = "context_filter", f"near-duplicate of {dup.chunk_id}"
                    dropped.append(h)
                else:
                    nxt.append(h)
            kept = nxt

        # 3. neighbour expansion
        if p.expand_neighbors and kept:
            present = {h.chunk_id for h in kept}
            extra = []
            for h in kept:
                i = by[h.chunk_id].index
                for d in range(-p.expand_neighbors, p.expand_neighbors + 1):
                    j = i + d
                    if 0 <= j < len(cs.chunks) and cs.chunks[j].id not in present:
                        present.add(cs.chunks[j].id)
                        extra.append(Hit(chunk_id=cs.chunks[j].id, scores={}, ranks={},
                                         drop_reason=f"neighbour of {h.chunk_id}"))
            kept = kept + extra

        # 4. merge adjacent: order by document position so adjacent chunks read contiguously
        if p.merge_adjacent:
            kept = sorted(kept, key=lambda h: by[h.chunk_id].index)
            ctx.trace["merged_groups"] = _groups([by[h.chunk_id].index for h in kept])

        # 5. token budget
        budget, used, nxt = p.max_context_tokens, 0, []
        for h in kept:
            t = by[h.chunk_id].tokens
            if used + t > budget:
                h.dropped_by, h.drop_reason = "context_filter", f"token budget {budget} exceeded"
                dropped.append(h)
            else:
                used += t
                nxt.append(h)
        ctx.trace["context_tokens"] = used
        return nxt, dropped


def _groups(idx):
    groups, cur = [], []
    for i in idx:
        if cur and i != cur[-1] + 1:
            groups.append(cur)
            cur = []
        cur.append(i)
    if cur:
        groups.append(cur)
    return [[f"C{i + 1}" for i in g] for g in groups]
