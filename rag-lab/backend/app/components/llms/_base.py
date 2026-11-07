from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator

from pydantic import BaseModel, Field

from app.core.capability import Capability, guard_methods
from app.core.registry import Component
from app.core.types import Chunk, Usage

# USD per 1M tokens (input, output). Local models are free. Extend/override with LLM_PRICES in .env.
PRICES = {
    "claude-opus-5-5": (15.0, 75.0), "claude-sonnet-5-5": (3.0, 15.0), "claude-haiku-5-5": (1.0, 5.0),
    "gpt-4o": (2.5, 10.0), "gpt-4o-mini": (0.15, 0.6), "gpt-4.1-mini": (0.4, 1.6), "gpt-4.1": (2.0, 8.0),
}


def price(model: str, tin: int, tout: int) -> float:
    table = dict(PRICES)
    try:
        table.update({k: tuple(v) for k, v in json.loads(os.environ.get("LLM_PRICES") or "{}").items()})
    except (ValueError, TypeError):
        pass
    pi, po = table.get(model, (0.0, 0.0))
    return round(tin / 1e6 * pi + tout / 1e6 * po, 6)


class LLMParams(BaseModel):
    temperature: float = Field(0.1, ge=0.0, le=2.0, description="Sampling temperature")
    max_tokens: int = Field(512, ge=16, le=4096, description="Max output tokens")
    streaming: bool = Field(True, description="Stream tokens as they are generated")


class BaseLLM(Capability, Component):
    """Base for every LLM provider. A provider is one file: subclass this, implement ``stream`` (and optionally
    ``complete`` / ``available`` / ``ping``), and decorate with ``@register("llm", "<name>")``.

    ``ready()`` = access policy + ``available()``. Subclass ``stream``/``complete`` are wrapped with a hard policy
    guard, so no provider can make a call while LLM calls are switched off.
    """

    policy_kind = "llm"
    uses_model = True  # False only for the extractive (no-LLM) answerer
    default_model = ""

    def __init_subclass__(cls, **kw):
        super().__init_subclass__(**kw)
        guard_methods(cls, ("stream", "complete"), "llm", applies=lambda self: self.uses_model)

    def __init__(self, params):
        super().__init__(params)
        self.usage = Usage()
        self.context_chunks: list[Chunk] | None = None

    def uses_policy(self) -> bool:
        return self.uses_model

    @property
    def model_name(self) -> str:
        return getattr(self.p, "model", self.component_name)

    async def ping(self) -> tuple[bool, str]:
        """Connection test (may hit the provider's API, e.g. list models; never spends tokens)."""
        return self.available()

    async def stream(self, system: str, user: str) -> AsyncIterator[str]:  # pragma: no cover - abstract
        raise NotImplementedError
        yield ""  # makes this an async generator  # noqa: unreachable

    async def complete(self, system: str, user: str, json_mode: bool = False) -> str:
        return "".join([t async for t in self.stream(system, user)])

    def _account(self, tin: int, tout: int):
        self.usage.input_tokens += tin
        self.usage.output_tokens += tout
        self.usage.cost_usd = round(self.usage.cost_usd + price(self.model_name, tin, tout), 6)
