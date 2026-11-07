"""Shared data types passed between pipeline stages."""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class Block(BaseModel):
    """A structural unit of a parsed document (heading, paragraph, list, code...)."""
    kind: str  # heading | paragraph | list | code | table | other
    start: int  # char offset into Document.text (inclusive)
    end: int  # char offset (exclusive)
    page: Optional[int] = None
    level: int = 0  # heading level (1..6) when kind == heading
    heading_path: list[str] = Field(default_factory=list)


class Document(BaseModel):
    id: str
    name: str
    kind: str  # md | pdf | txt
    text: str
    blocks: list[Block]
    pages: int = 0
    meta: dict[str, Any] = Field(default_factory=dict)

    def location(self, start: int) -> tuple[Optional[int], list[str]]:
        """Return (page, heading_path) of the block containing char offset."""
        best = None
        for b in self.blocks:
            if b.start <= start < max(b.end, b.start + 1):
                return b.page, b.heading_path
            if b.start <= start:
                best = b
        if best is not None:
            return best.page, best.heading_path
        return None, []


class Chunk(BaseModel):
    id: str
    index: int
    start: int
    end: int
    text: str
    index_text: str  # text that is indexed / embedded (may have heading path prepended)
    tokens: int
    page: Optional[int] = None
    heading_path: list[str] = Field(default_factory=list)


class ChunkSet(BaseModel):
    key: str
    doc_id: str
    chunks: list[Chunk]

    def by_id(self) -> dict[str, Chunk]:
        return {c.id: c for c in self.chunks}


class Hit(BaseModel):
    chunk_id: str
    scores: dict[str, float] = Field(default_factory=dict)  # bm25 / dense / fused / rerank
    ranks: dict[str, int] = Field(default_factory=dict)  # 1-based rank in each list
    dropped_by: Optional[str] = None  # stage that removed it (fusion/rerank/filter...)
    drop_reason: Optional[str] = None


class QueryBundle(BaseModel):
    original: str
    queries: list[str]  # lexical queries (BM25) - always includes something
    dense_queries: list[str]  # queries to embed (HyDE replaces these)
    notes: dict[str, Any] = Field(default_factory=dict)


class RetrievalOutput(BaseModel):
    lists: dict[str, list[Hit]]  # retriever name -> ranked hits (bm25/dense)


class Usage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
