from typing import Literal

from pydantic import BaseModel, Field

from app.core.registry import Component, register


@register("tokenizer", "tiktoken", label="tiktoken", order=1)
class TiktokenTokenizer(Component):
    """OpenAI BPE tokenizer (cl100k_base by default). Used for every token count."""

    class Params(BaseModel):
        encoding: Literal["cl100k_base", "o200k_base"] = Field("cl100k_base", description="BPE encoding")

    _encs: dict = {}

    def __init__(self, params):
        super().__init__(params)
        import tiktoken

        if params.encoding not in self._encs:
            self._encs[params.encoding] = tiktoken.get_encoding(params.encoding)
        self.enc = self._encs[params.encoding]

    def encode(self, text: str) -> list[int]:
        return self.enc.encode(text, disallowed_special=())

    def count(self, text: str) -> int:
        return len(self.encode(text))

    def offsets(self, text: str) -> list[tuple[int, int]]:
        toks = self.encode(text)
        if not toks:
            return []
        _, starts = self.enc.decode_with_offsets(toks)
        spans = []
        for i, s in enumerate(starts):
            e = starts[i + 1] if i + 1 < len(starts) else len(text)
            spans.append((s, max(e, s)))
        return spans
