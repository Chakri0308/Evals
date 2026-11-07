"""Run panes (streamed), run history and saved pipeline presets."""
from __future__ import annotations

import asyncio
import time
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core import storage
from app.core.defaults import default_panes
from app.core.pipeline import PipelineConfig, run_pipeline

from .deps import Put, doc_or_404, stream_queue

router = APIRouter(tags=["runs"])


class RunReq(BaseModel):
    doc_id: str
    question: str
    pipelines: list[PipelineConfig]
    save_history: bool = True


@router.post("/run")
async def run(req: RunReq):
    """Run every pipeline on the question concurrently; stream stage events, tokens and results (SSE)."""
    d = doc_or_404(req.doc_id)
    if not req.question.strip():
        raise HTTPException(400, "question is empty")

    async def producer(put: Put) -> None:
        results: dict[str, dict] = {}

        async def one(p: PipelineConfig) -> None:
            async def emit(ev: str, data: dict) -> None:
                await put(ev, {"pane": p.id, **data})

            results[p.id] = await run_pipeline(d, p, req.question, emit)

        await asyncio.gather(*(one(p) for p in req.pipelines))
        if req.save_history:
            hid = f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:4]}"
            storage.history.put(hid, {
                "id": hid, "ts": time.time(), "doc_id": d.id, "doc_name": d.name, "question": req.question,
                "pipelines": [p.model_dump() for p in req.pipelines], "results": results})
            await put("history", {"id": hid})
        await put("all_done", {})

    return stream_queue(producer)


# ------------------------------------------------------------------ history
@router.get("/history")
def history(limit: int = 50):
    return [{"id": r["id"], "ts": r["ts"], "question": r["question"], "doc_name": r.get("doc_name"),
             "doc_id": r["doc_id"], "panes": [x["name"] for x in r["pipelines"]]}
            for r in storage.history.list(limit=limit) if "id" in r]


@router.get("/history/{hid}")
def history_item(hid: str):
    rec = storage.history.get(hid)
    if rec is None:
        raise HTTPException(404)
    return rec


@router.delete("/history")
def history_clear():
    storage.history.clear()
    return {"ok": True}


# ------------------------------------------------------------------ presets
class Preset(BaseModel):
    name: str
    pipeline: dict


@router.get("/presets")
def presets():
    builtin = [{"name": f"Default · {p['name']}", "builtin": True, "pipeline": p} for p in default_panes()]
    saved = [{**r, "builtin": False} for r in storage.presets.list(newest_first=False)]
    return builtin + saved


@router.post("/presets")
def save_preset(p: Preset):
    storage.presets.put(p.name or "preset", p.model_dump())
    return {"ok": True}


@router.delete("/presets/{name}")
def delete_preset(name: str):
    storage.presets.delete(name)
    return {"ok": True}
