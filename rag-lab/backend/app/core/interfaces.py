"""Abstract interfaces (Protocols) for each component kind."""
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any, Optional, Protocol

import numpy as np

from .types import Chunk, ChunkSet, Document, Hit, QueryBundle, RetrievalOutput, Usage


class Parser(Protocol):
    extensions: tuple[str, ...]

    def parse(self, data: bytes, name: str, doc_id: str) -> Document: ...


class Tokenizer(Protocol):
    def encode(self, text: str) -> list[int]: ...

    def count(self, text: str) -> int: ...

    def offsets(self, text: str) -> list[tuple[int, int]]:
        """Char span of each token."""
        ...


class Chunker(Protocol):
    def chunk(self, doc: Document, ctx: Ctx) -> list[Chunk]: ...


class Embedder(Protocol):
    def cache_id(self) -> dict: ...

    def embed_documents(self, texts: list[str]) -> np.ndarray: ...

    def embed_query(self, text: str) -> np.ndarray: ...


class Retriever(Protocol):
    async def retrieve(self, qb: QueryBundle, cs: ChunkSet, ctx: Ctx) -> RetrievalOutput: ...


class Fuser(Protocol):
    def fuse(self, out: RetrievalOutput) -> list[Hit]: ...


class Reranker(Protocol):
    async def rerank(self, question: str, hits: list[Hit], cs: ChunkSet, ctx: Ctx) -> list[Hit]: ...


class QueryTransformer(Protocol):
    async def transform(self, question: str, ctx: Ctx) -> QueryBundle: ...


class ContextFilter(Protocol):
    def filter(self, hits: list[Hit], cs: ChunkSet, ctx: Ctx) -> tuple[list[Hit], list[Hit]]:
        """Return (kept, dropped)."""
        ...


class PromptBuilder(Protocol):
    def build(self, question: str, chunks: list[Chunk], closed_book: bool) -> dict: ...


class LLM(Protocol):
    def ready(self) -> tuple[bool, str]: ...

    def stream(self, system: str, user: str) -> AsyncIterator[str]: ...

    async def complete(self, system: str, user: str, json_mode: bool = False) -> str: ...

    usage: Usage


class Judge(Protocol):
    async def judge(self, item: dict, answer: str, context: list[Chunk], cited: list[str],
                    gold_hit_ids: list[str]) -> dict: ...


class Ctx:
    """Per-run context passed to components (access to shared services)."""

    def __init__(self, doc: Document, tokenizer, llm_factory=None, trace: Optional[dict] = None):
        self.doc = doc
        self.tokenizer = tokenizer
        self.llm_factory = llm_factory  # () -> LLM (the pane's generation LLM)
        self.trace: dict[str, Any] = trace if trace is not None else {}
