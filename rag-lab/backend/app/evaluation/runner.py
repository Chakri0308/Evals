"""Batch evaluation: question set × pipelines → per-question metrics, leaderboard, per-category breakdown."""
from __future__ import annotations

import asyncio
import time
import uuid
from collections import defaultdict
from collections.abc import Awaitable, Callable
from statistics import mean
from typing import Optional

from app.core import storage
from app.core.documents import get_chunkset
from app.core.pipeline import PipelineConfig, run_pipeline
from app.core.registry import create
from app.core.types import Document

from .metrics import gold_chunk_ids, hit_at_k, mrr, ndcg_at_k, percentile, recall_at_k

ANSWERABLE_EXCLUDE = {"unanswerable", "ambiguous"}


def _avg(xs):
    xs = [x for x in xs if x is not None]
    return round(mean(xs), 4) if xs else None


async def evaluate(doc: Document, questions: list[dict], pipelines: list[PipelineConfig], k: int = 5,
                   judge: Optional[dict] = None, generate_answers: bool = True,
                   progress: Optional[Callable[[dict], Awaitable[None]]] = None) -> dict:
    judge_cfg = judge or {"component": "heuristic", "params": {}}
    j = create("judge", judge_cfg["component"], judge_cfg.get("params", {}))
    rows: list[dict] = []
    total = len(questions) * len(pipelines)
    done = 0
    t_start = time.time()

    for q in questions:
        async def one(p: PipelineConfig, q: dict = q):
            cfg = p.model_copy(deep=True)
            if not generate_answers:
                cfg.stages["generation"].enabled = False
            res = await run_pipeline(doc, cfg, q["question"], emit=None, stream_tokens=False)
            sc = cfg.stages["chunking"]
            cs, _ = get_chunkset(doc, sc.component, sc.params, sc.enabled, cfg.tokenizer)
            by = cs.by_id()
            spans = q.get("gold_spans") or []
            gold = set(gold_chunk_ids(cs.chunks, spans))
            ranked_ids = [h["chunk_id"] for h in res.get("hits", [])]
            ranked_ids += [h["chunk_id"] for h in sorted(res.get("dropped", []),
                                                          key=lambda h: h["ranks"].get("retrieval", 999))]
            ranked_chunks = [by[c] for c in ranked_ids if c in by]
            not_ready = res.get("not_ready")
            has_gold = bool(spans) and q["category"] not in ANSWERABLE_EXCLUDE and not not_ready
            row = {
                "question_id": q["id"], "category": q["category"], "pane": p.id, "pipeline": p.name,
                "question": q["question"], "answer": res.get("answer", ""), "error": res.get("error"),
                "retrieved": [h["chunk_id"] for h in res.get("hits", [])], "gold_chunks": sorted(gold),
                "cited": res.get("cited", []), "latency_ms": res.get("total_ms", 0),
                "tokens_in": res.get("usage", {}).get("input_tokens", 0),
                "tokens_out": res.get("usage", {}).get("output_tokens", 0),
                "cost_usd": res.get("usage", {}).get("cost_usd", 0.0),
                "timings": res.get("timings", {}),
                "not_ready": (not_ready or {}).get("missing"),
                "answer_source": (res.get("answer_source") or {}).get("kind", "llm"),
            }
            if has_gold:
                row.update({
                    f"hit@{k}": hit_at_k(ranked_ids, gold, k), f"recall@{k}": round(recall_at_k(ranked_chunks, spans, k), 4),
                    "mrr": round(mrr(ranked_ids, gold), 4), f"ndcg@{k}": round(ndcg_at_k(ranked_ids, gold, k), 4),
                })
            if generate_answers and not res.get("error") and not not_ready:
                ctx_chunks = [by[c] for c in row["retrieved"] if c in by]
                try:
                    row["judge"] = await j.judge(q, row["answer"], ctx_chunks, row["cited"], sorted(gold))
                except Exception as e:  # noqa: BLE001
                    row["judge"] = {"error": str(e)}
            return row

        res_rows = await asyncio.gather(*(one(p) for p in pipelines))
        for r in res_rows:
            rows.append(r)
            done += 1
            if progress:
                await progress({"done": done, "total": total, "row": r})

    summary = summarize(rows, pipelines, k)
    out = {"id": uuid.uuid4().hex[:10], "doc_id": doc.id, "k": k, "created": time.time(),
           "duration_s": round(time.time() - t_start, 1), "judge": judge_cfg, "rubric": getattr(j, "rubric", ""),
           "pipelines": [p.model_dump() for p in pipelines], "rows": rows, **summary}
    storage.evals.put(out["id"], out)
    return out


def summarize(rows: list[dict], pipelines: list[PipelineConfig], k: int) -> dict:
    metric_keys = [f"hit@{k}", f"recall@{k}", "mrr", f"ndcg@{k}"]
    judge_keys = ["correctness", "faithfulness", "citation_accuracy"]
    lb = []
    by_cat: dict = defaultdict(dict)
    for p in pipelines:
        pr = [r for r in rows if r["pane"] == p.id]
        entry = {"pane": p.id, "pipeline": p.name, "color": p.color, "n": len(pr)}
        for m in metric_keys:
            entry[m] = _avg([r.get(m) for r in pr])
        for m in judge_keys:
            entry[m] = _avg([(r.get("judge") or {}).get(m) for r in pr])
        abst = [(r.get("judge") or {}).get("abstention_correct") for r in pr]
        abst = [a for a in abst if a is not None]
        entry["abstention_acc"] = round(sum(abst) / len(abst), 4) if abst else None
        lat = [r["latency_ms"] for r in pr]
        entry["latency_p50"] = round(percentile(lat, 50), 1)
        entry["latency_p95"] = round(percentile(lat, 95), 1)
        entry["tokens_in"] = sum(r["tokens_in"] for r in pr)
        entry["tokens_out"] = sum(r["tokens_out"] for r in pr)
        entry["cost_usd"] = round(sum(r["cost_usd"] for r in pr), 6)
        entry["errors"] = sum(1 for r in pr if r.get("error"))
        entry["not_ready"] = sum(1 for r in pr if r.get("not_ready"))
        entry["fallback_answers"] = sum(1 for r in pr if r.get("answer_source") == "extractive_fallback")
        lb.append(entry)
        cats = defaultdict(list)
        for r in pr:
            cats[r["category"]].append(r)
        for cat, rs in cats.items():
            by_cat[cat][p.id] = {
                "n": len(rs), **{m: _avg([r.get(m) for r in rs]) for m in metric_keys},
                "correctness": _avg([(r.get("judge") or {}).get("correctness") for r in rs]),
            }
    lb.sort(key=lambda e: -((e.get(f"recall@{k}") or 0) + (e.get("mrr") or 0) + (e.get("correctness") or 0) / 5))
    return {"leaderboard": lb, "by_category": by_cat}
