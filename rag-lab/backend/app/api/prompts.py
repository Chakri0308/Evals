"""Saved prompt versions: named snapshots of the Prompt stage's params, so prompts can be compared in Batch Eval."""
from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core import storage
from app.core.storage import safe_name

router = APIRouter(tags=["prompts"])


class PromptVersion(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    note: str = Field("", max_length=500)
    component: str = "template"
    params: dict[str, Any] = Field(default_factory=dict)


@router.get("/prompts")
def list_prompts():
    return storage.prompts.list(newest_first=True)


@router.post("/prompts")
def save_prompt(req: PromptVersion):
    """Create a version, or overwrite the one with the same name."""
    key = safe_name(req.name, "prompt")
    prev = storage.prompts.get(key)
    rec = {**req.model_dump(), "id": key, "name": req.name.strip(),
           "created": prev["created"] if prev else time.time(), "updated": time.time()}
    storage.prompts.put(key, rec)
    return rec


@router.delete("/prompts/{pid}")
def delete_prompt(pid: str):
    if not storage.prompts.delete(pid):
        raise HTTPException(404)
    return {"ok": True}
