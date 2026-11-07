"""One place to resolve "which LLM?" for everything that is not a pane's Generate stage
(question generator, LLM judge) and to describe every provider / embedder / vector store for the UI."""
from __future__ import annotations

import asyncio
from typing import Any

from . import embeddings, settings, vectorstore
from .registry import all_specs, create, get_spec


def resolve_llm(provider: str | None, model: str | None) -> tuple[str, str]:
    s = settings.get()
    prov = s["llm_provider"] if not provider or provider == "default" else provider
    if model:
        return prov, model
    if prov == s["llm_provider"] and s["llm_model"]:
        return prov, s["llm_model"]
    return prov, getattr(get_spec("llm", prov).cls, "default_model", "") or ""


def make_llm(provider: str | None = None, model: str | None = None, **params):
    prov, mdl = resolve_llm(provider, model)
    p = dict(params)
    if mdl and "model" in get_spec("llm", prov).params_model.model_fields:
        p["model"] = mdl
    return create("llm", prov, p)


def _llm_row(spec) -> dict:
    try:
        llm = create("llm", spec.name, {})
        ok, why = llm.ready()
    except Exception as e:  # noqa: BLE001
        llm, ok, why = None, False, str(e)
    fields = spec.params_model.model_fields
    examples = []
    if "model" in fields:
        extra = fields["model"].json_schema_extra or {}
        examples = list(extra.get("examples", []))
    return {"name": spec.name, "label": spec.label, "description": spec.description, "ready": ok, "detail": why,
            "uses_model": getattr(spec.cls, "uses_model", True),
            "default_model": getattr(spec.cls, "default_model", ""), "examples": examples}


_emb_cache: dict[str, tuple[float, bool, str]] = {}


def _emb_status(spec_str: str, fresh: bool) -> tuple[bool, str]:
    """Embedding-model readiness, cached for a minute (it may probe huggingface.co)."""
    import time

    if not settings.embeddings_allowed():
        return False, settings.POLICY_EMB
    hit = _emb_cache.get(spec_str)
    if hit and not fresh and time.time() - hit[0] < 60:
        return hit[1], hit[2]
    try:
        ok, why = embeddings.make(spec_str)[0].ready()
    except Exception as e:  # noqa: BLE001
        ok, why = False, str(e)
    _emb_cache[spec_str] = (time.time(), ok, why)
    return ok, why


def _emb_rows(fresh: bool = False) -> list[dict]:
    rows = []
    for spec_str in embeddings.EXAMPLES[1:]:
        ok, why = _emb_status(spec_str, fresh)
        rows.append({"name": spec_str, "ready": ok, "detail": why})
    cur = settings.get()["embedding_model"]
    if cur not in embeddings.EXAMPLES:
        ok, why = _emb_status(cur, fresh)
        rows.insert(0, {"name": cur, "ready": ok, "detail": why})
    return rows


def capabilities(fresh: bool = False) -> dict[str, Any]:
    if fresh:
        vectorstore.forget()
    s = settings.get()
    llms = [_llm_row(sp) for sp in all_specs()["llm"]]
    stores = []
    for sp in all_specs()["vector_store"]:
        ok, why = vectorstore.check(sp.name, fresh=fresh)
        stores.append({"name": sp.name, "label": sp.label, "description": sp.description, "ready": ok, "detail": why,
                       "needs": getattr(sp.cls, "needs", "")})
    any_llm = any(r["ready"] and r["uses_model"] for r in llms)
    if not s["allow_llm"] and not s["allow_embeddings"]:
        mode = "offline"
    elif not s["allow_llm"]:
        mode = "no_llm"
    elif not s["allow_embeddings"]:
        mode = "no_embeddings"
    else:
        mode = "full"
    return {"settings": s, "locks": settings.locks(), "mode": mode, "any_llm_ready": any_llm,
            "llms": llms, "embedders": _emb_rows(fresh), "vector_stores": stores}


async def ping_llm(provider: str) -> dict:
    """Explicit connection test from the Settings dialog (lists models; spends no tokens)."""
    if not settings.llm_allowed():
        return {"ok": False, "detail": settings.POLICY_LLM}
    llm = create("llm", provider, {})
    try:
        ok, why = await asyncio.wait_for(llm.ping(), timeout=12)
    except Exception as e:  # noqa: BLE001
        ok, why = False, f"{type(e).__name__}: {e}"
    return {"ok": ok, "detail": why}
