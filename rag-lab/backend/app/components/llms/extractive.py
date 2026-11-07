import asyncio
import re

from pydantic import BaseModel, Field

from app.core.indexes import bm25_tokenize
from app.core.registry import register

from ._base import BaseLLM


@register("llm", "extractive", label="Extractive (no LLM)", order=9)
class ExtractiveLLM(BaseLLM):
    """No model: quotes the context sentences that overlap most with the question, with citations. Useful offline, or for isolating retrieval quality."""

    uses_model = False

    class Params(BaseModel):
        sentences: int = Field(3, ge=1, le=10, description="Sentences to quote")
        streaming: bool = Field(True, description="Stream word by word")

    @property
    def model_name(self):
        return "extractive"

    async def stream(self, system, user):
        q = user.rsplit("Question:", 1)[-1]
        qt = set(bm25_tokenize(q))
        cands = []
        for c in self.context_chunks or []:
            for s in re.split(r"(?<=[.!?])\s+|\n+", c.text):
                s = s.strip(" -*#>\t")
                if len(s) < 15:
                    continue
                st = set(bm25_tokenize(s))
                score = len(qt & st) / (len(qt) + 1e-9)
                cands.append((score, c.id, s))
        cands.sort(key=lambda x: -x[0])
        picked = [c for c in cands if c[0] > 0][: self.p.sentences]
        if not picked:
            text = "I don't know: no context sentence overlaps with the question."
        else:
            text = " ".join(f"{s} [{cid}]" for _, cid, s in picked)
        for w in re.findall(r"\S+\s*", text):
            yield w
            if self.p.streaming:
                await asyncio.sleep(0.01)
        self._account(len(user) // 4, len(text) // 4)

    async def complete(self, system, user, json_mode=False):
        if json_mode:
            return "{}"
        return await super().complete(system, user)
