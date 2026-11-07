"""Health, component registry, capabilities, settings and connection tests."""
from __future__ import annotations

from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.components.llms.ollama_llm import ollama_base, ollama_models
from app.core import embeddings, providers, settings, vectorstore
from app.core.defaults import default_panes
from app.core.pipeline import STAGES
from app.core.registry import STAGE_TO_KIND, all_specs, get_spec
from app.qgen.categories import CATEGORIES

router = APIRouter(tags=["meta"])


@router.get("/health")
def health():
    return {"ok": True}


@router.get("/status")
def status():
    """Ollama reachability + model list, and suggestion lists for the config forms."""
    try:
        httpx.get(f"{ollama_base()}/api/version", timeout=1.5).raise_for_status()
        up = True
    except httpx.HTTPError:
        up = False
    return {
        "ollama": {"up": up, "url": ollama_base(), "models": ollama_models() if up else []},
        "suggest": {
            "vector_stores": ["default", *vectorstore.names()],
            "embedding_models": embeddings.EXAMPLES,
            "llm_providers": ["default", *(sp.name for sp in all_specs()["llm"])],
        },
    }


@router.get("/components")
def components():
    specs = all_specs()

    def ser(s):
        return {"name": s.name, "label": s.label, "description": s.description, "schema": s.schema()}

    return {
        "stages": [{"stage": st, "kind": STAGE_TO_KIND[st], "components": [ser(s) for s in specs[STAGE_TO_KIND[st]]]}
                   for st in STAGES],
        "kinds": {k: [ser(s) for s in v] for k, v in specs.items()},
        "default_panes": default_panes(),
    }


@router.get("/categories")
def categories():
    return [{k: v for k, v in c.items() if k != "instruction"} for c in CATEGORIES]


@router.get("/capabilities")
def capabilities(refresh: bool = False):
    """Policy switches and the status of every LLM provider, embedding model and vector store."""
    return providers.capabilities(fresh=refresh)


@router.get("/vectorstore")
def vectorstore_info():
    """Every vector store: connection status, location and the collections RAG Lab created in it."""
    return {"default": settings.get()["vector_store"], "stores": vectorstore.stats()}


class SettingsReq(BaseModel):
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    embedding_model: Optional[str] = None
    vector_store: Optional[str] = None
    allow_llm: Optional[bool] = None
    allow_embeddings: Optional[bool] = None


@router.get("/settings")
def get_settings():
    return {"settings": settings.get(), "locks": settings.locks()}


@router.put("/settings")
def put_settings(req: SettingsReq):
    changes = req.model_dump(exclude_none=True)
    try:
        if "llm_provider" in changes:
            get_spec("llm", changes["llm_provider"])
        if "vector_store" in changes:
            get_spec("vector_store", changes["vector_store"])
        out = settings.update(changes)
    except PermissionError as e:
        raise HTTPException(403, str(e)) from e
    except (KeyError, ValueError) as e:
        raise HTTPException(400, str(e)) from e
    vectorstore.forget()
    return {"settings": out, "locks": settings.locks()}


@router.post("/llm/{provider}/ping")
async def ping_llm(provider: str):
    try:
        return await providers.ping_llm(provider)
    except KeyError as e:
        raise HTTPException(404, str(e)) from e
