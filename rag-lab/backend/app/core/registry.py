"""Component registry.

Every pluggable component lives in its own file under ``app/components/<stage>/`` and
registers itself with ``@register(<kind>, <name>)``. It declares a nested Pydantic model
called ``Params``, whose JSON Schema the frontend uses to render the config form.

Adding a component = adding one file. ``discover()`` imports every module under
``app.components`` automatically.
"""
from __future__ import annotations

import importlib
import pkgutil
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Optional

from pydantic import BaseModel

# Component kinds (interfaces) and the pipeline stage each one is selectable in.
KINDS = [
    "parser", "tokenizer", "chunker", "embedder", "retriever", "fuser", "reranker",
    "query_transform", "context_filter", "prompt", "llm", "judge", "vector_store",
]

STAGE_TO_KIND = {
    "query_transform": "query_transform",
    "chunking": "chunker",
    "retrieval": "retriever",
    "fusion": "fuser",
    "rerank": "reranker",
    "context_filter": "context_filter",
    "prompt": "prompt",
    "generation": "llm",
}


class NoParams(BaseModel):
    pass


@dataclass
class ComponentSpec:
    kind: str
    name: str
    cls: type
    params_model: type[BaseModel]
    label: str
    description: str
    order: int

    def schema(self) -> dict[str, Any]:
        return self.params_model.model_json_schema()


_REGISTRY: dict[str, dict[str, ComponentSpec]] = {k: {} for k in KINDS}


def register(kind: str, name: str, *, label: Optional[str] = None, order: int = 100) -> Callable:
    if kind not in _REGISTRY:
        raise ValueError(f"Unknown component kind '{kind}'. Known: {KINDS}")

    def deco(cls):
        params_model = getattr(cls, "Params", NoParams)
        doc = (cls.__doc__ or "").strip()
        _REGISTRY[kind][name] = ComponentSpec(
            kind=kind, name=name, cls=cls, params_model=params_model,
            label=label or name.replace("_", " ").title(),
            description=doc.split("\n\n")[0].replace("\n", " "), order=order,
        )
        cls.component_name = name
        return cls

    return deco


def get_spec(kind: str, name: str) -> ComponentSpec:
    try:
        return _REGISTRY[kind][name]
    except KeyError:
        raise KeyError(f"No {kind} component named '{name}'. Available: {list(_REGISTRY[kind])}") from None


def create(kind: str, name: str, params: Optional[dict] = None):
    """Instantiate a component with validated params."""
    spec = get_spec(kind, name)
    p = spec.params_model(**(params or {}))
    return spec.cls(p)


def validate_params(kind: str, name: str, params: Optional[dict]) -> BaseModel:
    return get_spec(kind, name).params_model(**(params or {}))


def all_specs() -> dict[str, list[ComponentSpec]]:
    return {k: sorted(v.values(), key=lambda s: (s.order, s.name)) for k, v in _REGISTRY.items()}


_discovered = False


def discover() -> None:
    global _discovered
    if _discovered:
        return
    import app.components as root

    for mod in pkgutil.walk_packages(root.__path__, root.__name__ + "."):
        importlib.import_module(mod.name)
    _discovered = True


class Component:
    """Base class: stores validated params on ``self.p``."""

    Params: type[BaseModel] = NoParams

    def __init__(self, params: BaseModel):
        self.p = params
