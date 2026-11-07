"""Question-set generation, gold-span validation, "why is this a good test?" analysis, saved sets."""
from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core import storage
from app.qgen.analysis import analyze
from app.qgen.generator import generate, revalidate

from .deps import doc_or_404, stream_job

router = APIRouter(prefix="/questions", tags=["questions"])


class GenerateReq(BaseModel):
    doc_id: str
    categories: dict[str, int]
    mode: str = "llm"  # llm | heuristic
    llm: Optional[dict] = None  # {provider, model}; None means the Settings default
    seed: int = 7


@router.post("/generate")
async def generate_set(req: GenerateReq):
    d = doc_or_404(req.doc_id)

    async def job(progress):
        return {"items": await generate(d, req.categories, req.mode, req.llm, req.seed, progress)}

    return stream_job(job)


class AnalyzeReq(BaseModel):
    doc_id: str
    items: list[dict]
    chunking: Optional[dict] = None  # the pane's chunking stage, so ranks match what the panes see
    embedding_model: Optional[str] = None


@router.post("/analyze")
async def analyze_set(req: AnalyzeReq):
    """Per question: terminology map, measured BM25/semantic/hybrid ranks and a verdict; plus suggestions."""
    d = doc_or_404(req.doc_id)
    try:
        return await asyncio.to_thread(analyze, d, req.items, req.chunking, req.embedding_model)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"{type(e).__name__}: {e}") from e


class ValidateReq(BaseModel):
    doc_id: str
    item: dict


@router.post("/validate")
def validate(req: ValidateReq):
    return revalidate(doc_or_404(req.doc_id), req.item)


# ------------------------------------------------------------------ saved question sets
class QSet(BaseModel):
    name: str
    doc_id: str
    items: list[dict]


qsets_router = APIRouter(prefix="/qsets", tags=["questions"])


@qsets_router.get("")
def list_qsets(doc_id: Optional[str] = None):
    return storage.qsets.list(where=lambda r: not doc_id or r.get("doc_id") == doc_id)


@qsets_router.post("")
def save_qset(q: QSet):
    storage.qsets.put(f"{q.doc_id}-{q.name or 'set'}", q.model_dump())
    return {"ok": True}
