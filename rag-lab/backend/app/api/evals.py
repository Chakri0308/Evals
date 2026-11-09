"""Batch evaluation (streamed) and saved eval runs."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core import storage
from app.core.pipeline import PipelineConfig
from app.evaluation.runner import evaluate

from .deps import doc_or_404, stream_job

router = APIRouter(tags=["evals"])


class EvalReq(BaseModel):
    doc_id: str
    questions: list[dict]
    pipelines: list[PipelineConfig]
    k: int = Field(5, ge=1, le=50)
    judge: Optional[dict] = None
    generate_answers: bool = True


@router.post("/eval")
async def run_eval(req: EvalReq):
    d = doc_or_404(req.doc_id)

    async def job(progress):
        return await evaluate(d, req.questions, req.pipelines, req.k, req.judge, req.generate_answers, progress)

    return stream_job(job)


def _summary(r: dict) -> dict:
    """What the run list needs: identity, settings and the headline metrics per pipeline (not the rows)."""
    k = r["k"]
    return {
        "id": r["id"], "label": r.get("label", ""), "created": r["created"], "doc_id": r.get("doc_id"),
        "n": len(r["rows"]), "k": k, "duration_s": r.get("duration_s"), "judge": (r.get("judge") or {}).get("component"),
        "questions": len({x["question_id"] for x in r["rows"]}),
        "pipelines": [x["name"] for x in r["pipelines"]],
        "leaderboard": [{key: e.get(key) for key in ("pane", "pipeline", f"recall@{k}", "mrr", "correctness")}
                        for e in r.get("leaderboard", [])],
    }


@router.get("/evals")
def evals(doc_id: Optional[str] = None, limit: int = 100):
    where = (lambda r: r.get("doc_id") == doc_id) if doc_id else None
    return [_summary(r) for r in storage.evals.list(limit=limit, where=where)]


class EvalPatch(BaseModel):
    label: str = Field("", max_length=120)


@router.patch("/evals/{eid}")
def rename_eval(eid: str, req: EvalPatch):
    rec = storage.evals.get(eid)
    if rec is None:
        raise HTTPException(404)
    rec["label"] = req.label.strip()
    storage.evals.put(eid, rec)
    return _summary(rec)


@router.delete("/evals/{eid}")
def delete_eval(eid: str):
    if not storage.evals.delete(eid):
        raise HTTPException(404)
    return {"ok": True}


@router.get("/evals/{eid}")
def eval_item(eid: str):
    rec = storage.evals.get(eid)
    if rec is None:
        raise HTTPException(404)
    return rec
