"""Human annotations on run results: a verdict on the answer and relevance labels on retrieved chunks.

Each annotation is a self-contained snapshot (question, answer, the retrieved chunk texts, the pipeline config), so it
stays valid if the document is re-chunked later, and the judge can be re-run on it to measure judge-human agreement.
"""
from __future__ import annotations

import time
from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core import storage
from app.core.registry import create
from app.core.types import Chunk

from .deps import stream_job

router = APIRouter(tags=["annotations"])

Verdict = Optional[Literal["up", "down"]]
Relevance = Literal["relevant", "irrelevant"]


class AnnChunk(BaseModel):
    id: str
    start: int = 0
    end: int = 0
    text: str = ""
    page: Optional[int] = None
    heading_path: list[str] = Field(default_factory=list)


class Annotation(BaseModel):
    doc_id: str
    question: str
    pane: str = ""
    pipeline: str = ""
    config: dict[str, Any] = Field(default_factory=dict)
    answer: str = ""
    cited: list[str] = Field(default_factory=list)
    chunks: list[AnnChunk] = Field(default_factory=list)  # retrieved context, in rank order
    verdict: Verdict = None
    note: str = Field("", max_length=2000)
    chunk_labels: dict[str, Relevance] = Field(default_factory=dict)


@router.get("/annotations")
def list_annotations(doc_id: Optional[str] = None):
    where = (lambda r: r.get("doc_id") == doc_id) if doc_id else None
    return storage.annotations.list(newest_first=True, where=where)


@router.put("/annotations/{aid}")
def upsert_annotation(aid: str, req: Annotation):
    """Create or replace. An annotation with no verdict, note or chunk labels left is deleted."""
    if req.verdict is None and not req.note.strip() and not req.chunk_labels:
        storage.annotations.delete(aid)
        return {"id": aid, "deleted": True}
    prev = storage.annotations.get(aid)
    rec = {**req.model_dump(), "id": aid, "created": prev["created"] if prev else time.time(), "updated": time.time()}
    storage.annotations.put(aid, rec)
    return rec


@router.delete("/annotations/{aid}")
def delete_annotation(aid: str):
    if not storage.annotations.delete(aid):
        raise HTTPException(404)
    return {"ok": True}


class AgreementReq(BaseModel):
    doc_id: str
    judge: Optional[dict] = None
    threshold: float = Field(3.0, ge=1, le=5)  # judge score >= threshold counts as a pass


def _chunk(c: dict, i: int) -> Chunk:
    return Chunk(id=c["id"], index=i, start=c.get("start", 0), end=c.get("end", 0), text=c.get("text", ""),
                 index_text=c.get("text", ""), tokens=0, page=c.get("page"), heading_path=c.get("heading_path") or [])


@router.post("/annotations/agreement")
async def agreement(req: AgreementReq):
    """Re-judge every annotated answer and compare the judge's pass/fail with the human thumbs up/down."""
    judge_cfg = req.judge or {"component": "heuristic", "params": {}}
    items = [a for a in storage.annotations.list(where=lambda r: r.get("doc_id") == req.doc_id)
             if a.get("verdict") in ("up", "down") and a.get("answer")]

    async def job(progress):
        j = create("judge", judge_cfg["component"], judge_cfg.get("params", {}))
        rows = []
        for n, a in enumerate(items, 1):
            relevant = [cid for cid, lab in (a.get("chunk_labels") or {}).items() if lab == "relevant"]
            ctx = [_chunk(c, i) for i, c in enumerate(a.get("chunks") or [])]
            item = {"question": a["question"], "category": "human", "expected_answer": ""}
            try:
                res = await j.judge(item, a["answer"], ctx, a.get("cited") or [], relevant)
            except Exception as e:  # noqa: BLE001
                res = {"error": str(e)}
            # correctness needs an expected answer, which a human annotation doesn't have; the heuristic judge then
            # scores ~1, so fall back to faithfulness for it.
            score = res.get("faithfulness") if judge_cfg["component"] == "heuristic" else res.get("correctness")
            if score is None:
                score = res.get("correctness") if res.get("faithfulness") is None else res.get("faithfulness")
            judge_pass = None if score is None else score >= req.threshold
            human_pass = a["verdict"] == "up"
            rows.append({"id": a["id"], "question": a["question"], "pipeline": a.get("pipeline", ""),
                         "human": a["verdict"], "judge_score": score, "judge_pass": judge_pass,
                         "agree": None if judge_pass is None else judge_pass == human_pass,
                         "rationale": res.get("rationale") or res.get("error", "")})
            await progress({"done": n, "total": len(items)})
        scored = [r for r in rows if r["agree"] is not None]
        cm = {f"{h}_{jg}": sum(1 for r in scored if r["human"] == h and r["judge_pass"] == (jg == "pass"))
              for h in ("up", "down") for jg in ("pass", "fail")}
        return {"judge": judge_cfg, "threshold": req.threshold, "n": len(scored),
                "agreement": round(sum(r["agree"] for r in scored) / len(scored), 4) if scored else None,
                "confusion": cm, "rows": rows}

    return stream_job(job)
