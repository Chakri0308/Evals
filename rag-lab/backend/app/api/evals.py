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


@router.get("/evals")
def evals():
    return [{"id": r["id"], "created": r["created"], "n": len(r["rows"]), "k": r["k"],
             "pipelines": [x["name"] for x in r["pipelines"]]} for r in storage.evals.list(limit=30)]


@router.get("/evals/{eid}")
def eval_item(eid: str):
    rec = storage.evals.get(eid)
    if rec is None:
        raise HTTPException(404)
    return rec
