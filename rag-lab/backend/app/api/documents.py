"""Upload / list / read documents, and live chunking previews."""
from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.core.cache import DATA_DIR
from app.core.documents import doc_stats, get_chunkset, list_docs, parse_upload
from app.core.pipeline import StageConfig
from app.core.settings import Unavailable
from app.core.storage import safe_name

from .deps import doc_or_404

router = APIRouter(tags=["documents"])


@router.post("/documents")
async def upload(file: UploadFile = File(...)):  # noqa: B008  (FastAPI's dependency idiom)
    data = await file.read()
    try:
        doc, existed = await asyncio.to_thread(parse_upload, data, file.filename or "upload.md")
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"parse failed: {e}") from e
    return {**doc_stats(doc), "existed": existed}


@router.get("/documents")
def documents():
    return list_docs()


@router.get("/documents/{doc_id}")
def document(doc_id: str):
    d = doc_or_404(doc_id)
    return {**doc_stats(d), "text": d.text, "blocks": [b.model_dump() for b in d.blocks]}


@router.get("/documents/{doc_id}/file")
def document_file(doc_id: str):
    for p in (DATA_DIR / "uploads").glob(f"{safe_name(doc_id)}.*"):
        return FileResponse(p)
    raise HTTPException(404)


class PreviewReq(BaseModel):
    doc_id: str
    chunking: StageConfig
    tokenizer: str = "tiktoken"


@router.post("/chunk/preview")
async def chunk_preview(req: PreviewReq):
    d = doc_or_404(req.doc_id)
    t0 = time.perf_counter()
    try:
        cs, hit = await asyncio.to_thread(get_chunkset, d, req.chunking.component, req.chunking.params,
                                          req.chunking.enabled, req.tokenizer)
    except Unavailable as e:
        raise HTTPException(409, f"{e.reason}. Pick another chunker (heading-aware works without any model).") from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"{type(e).__name__}: {e}") from e
    toks = [c.tokens for c in cs.chunks]
    return {
        "key": cs.key, "cache_hit": hit, "ms": round((time.perf_counter() - t0) * 1000, 1),
        "stats": {"count": len(toks), "avg": round(sum(toks) / max(1, len(toks)), 1), "min": min(toks or [0]),
                  "max": max(toks or [0]), "total": sum(toks)},
        "chunks": [{"id": c.id, "start": c.start, "end": c.end, "tokens": c.tokens, "page": c.page,
                    "heading_path": c.heading_path} for c in cs.chunks],
    }
