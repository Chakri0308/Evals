"""Retrieval metrics against gold spans. A chunk is relevant if it overlaps a gold span."""
from __future__ import annotations

import math
from collections.abc import Iterable, Sequence


def overlaps(a_start: int, a_end: int, b_start: int, b_end: int) -> bool:
    return a_start < b_end and b_start < a_end


def gold_chunk_ids(chunks: Iterable, spans: Sequence[dict]) -> list[str]:
    out = []
    for c in chunks:
        if any(overlaps(c.start, c.end, s["start"], s["end"]) for s in spans):
            out.append(c.id)
    return out


def spans_covered(ranked_chunks: Sequence, spans: Sequence[dict]) -> int:
    return sum(1 for s in spans if any(overlaps(c.start, c.end, s["start"], s["end"]) for c in ranked_chunks))


def hit_at_k(ranked: Sequence[str], gold: set[str], k: int) -> float:
    return 1.0 if any(c in gold for c in ranked[:k]) else 0.0


def recall_at_k(ranked_chunks: Sequence, spans: Sequence[dict], k: int) -> float:
    """Fraction of gold spans covered by the top-k chunks (independent of chunk granularity)."""
    if not spans:
        return 0.0
    return spans_covered(ranked_chunks[:k], spans) / len(spans)


def mrr(ranked: Sequence[str], gold: set[str]) -> float:
    for i, c in enumerate(ranked, start=1):
        if c in gold:
            return 1.0 / i
    return 0.0


def ndcg_at_k(ranked: Sequence[str], gold: set[str], k: int) -> float:
    dcg = sum(1.0 / math.log2(i + 1) for i, c in enumerate(ranked[:k], start=1) if c in gold)
    ideal = sum(1.0 / math.log2(i + 1) for i in range(1, min(k, len(gold)) + 1))
    return dcg / ideal if ideal > 0 else 0.0


def percentile(vals: list[float], p: float) -> float:
    if not vals:
        return 0.0
    v = sorted(vals)
    i = (len(v) - 1) * p / 100
    lo, hi = math.floor(i), math.ceil(i)
    return v[lo] + (v[hi] - v[lo]) * (i - lo)
