"""Shared helpers for chunkers: span packing with exact token budgets and overlap."""
from __future__ import annotations

import re
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from app.core.types import Chunk, Document

Span = tuple[int, int]


class ChunkParams(BaseModel):
    chunk_size_tokens: int = Field(256, ge=64, le=2048, description="Maximum tokens per chunk")
    overlap_tokens: int = Field(32, ge=0, le=1024, description="Tokens shared with the previous chunk (≤ 50% of size)")
    min_chunk_tokens: int = Field(16, ge=0, le=512, description="Chunks smaller than this merge into the previous one")
    prepend_heading_path: bool = Field(True, description="Prefix the heading path to the indexed/embedded text")

    @model_validator(mode="after")
    def _overlap_cap(self):
        cap = self.chunk_size_tokens // 2
        if self.overlap_tokens > cap:
            self.overlap_tokens = cap
        return self


def strip_span(text: str, s: int, e: int) -> Span:
    while s < e and text[s].isspace():
        s += 1
    while e > s and text[e - 1].isspace():
        e -= 1
    return s, e


def split_by_sep(text: str, s: int, e: int, sep: str) -> list[Span]:
    """Split [s,e) on sep, keeping the separator attached to the preceding piece."""
    out, cur = [], s
    while True:
        i = text.find(sep, cur, e)
        if i < 0:
            break
        out.append((cur, i + len(sep)))
        cur = i + len(sep)
    if cur < e:
        out.append((cur, e))
    return [p for p in out if p[1] > p[0]]


_SENT = re.compile(r"(?<=[.!?:;])[\"')\]]*\s+(?=[\"'(\[*\-•]?[A-Z0-9`])")


def sentence_spans(text: str, s: int, e: int) -> list[Span]:
    spans: list[Span] = []
    for ls, le in split_by_sep(text, s, e, "\n"):
        ls, le = strip_span(text, ls, le)
        if le <= ls:
            continue
        cur = ls
        for m in _SENT.finditer(text, ls, le):
            spans.append((cur, m.start()))
            cur = m.end()
        if cur < le:
            spans.append((cur, le))
    return [sp for sp in spans if sp[1] > sp[0]]


def token_windows(text: str, s: int, e: int, tok, size: int, overlap: int = 0) -> list[Span]:
    offs = tok.offsets(text[s:e])
    if not offs:
        return [(s, e)] if e > s else []
    step = max(1, size - overlap)
    out = []
    i = 0
    while i < len(offs):
        j = min(i + size, len(offs))
        out.append((s + offs[i][0], s + offs[j - 1][1]))
        if j == len(offs):
            break
        i += step
    return out


def recursive_split(text: str, s: int, e: int, tok, size: int, seps: list[str]) -> list[Span]:
    if e <= s:
        return []
    if tok.count(text[s:e]) <= size:
        return [(s, e)]
    if not seps:
        return token_windows(text, s, e, tok, size)
    out: list[Span] = []
    for ps, pe in split_by_sep(text, s, e, seps[0]):
        out.extend(recursive_split(text, ps, pe, tok, size, seps[1:]))
    return out


def pack(text: str, spans: list[Span], tok, size: int, overlap: int) -> list[Span]:
    """Greedily pack ordered spans into chunks of <= size tokens with token overlap.

    Spans must each be <= size tokens (split them first).
    """
    if not spans:
        return []
    chunks: list[Span] = []
    i = 0
    n = len(spans)
    while i < n:
        start_idx = i
        cs = spans[i][0]
        ce = spans[i][1]
        i += 1
        while i < n and tok.count(text[cs:spans[i][1]]) <= size:
            ce = spans[i][1]
            i += 1
        chunks.append((cs, ce))
        if i >= n or overlap <= 0:
            continue
        # back up over trailing spans to create overlap, but keep progress
        j = i
        while j - 1 > start_idx and tok.count(text[spans[j - 1][0]:ce]) <= overlap:
            j -= 1
        # step back for overlap only if the next chunk (overlap + next span) still fits
        if j < i and tok.count(text[spans[j][0]:spans[i][1]]) <= size:
            i = j
    return chunks


def merge_small(text: str, spans: list[Span], tok, min_tokens: int) -> list[Span]:
    if min_tokens <= 0 or len(spans) < 2:
        return spans
    out: list[Span] = []
    for sp in spans:
        if out and tok.count(text[sp[0]:sp[1]]) < min_tokens:
            out[-1] = (out[-1][0], max(out[-1][1], sp[1]))
        else:
            out.append(sp)
    if len(out) > 1 and tok.count(text[out[0][0]:out[0][1]]) < min_tokens:
        out[1] = (out[0][0], out[1][1])
        out.pop(0)
    return out


def sections(doc: Document) -> list[Span]:
    """Section spans: each heading starts a new section."""
    starts = sorted({0} | {b.start for b in doc.blocks if b.kind == "heading"})
    out = []
    for k, st in enumerate(starts):
        en = starts[k + 1] if k + 1 < len(starts) else len(doc.text)
        if doc.text[st:en].strip():
            out.append((st, en))
    return out


def finalize(doc: Document, spans: list[Span], tok, prepend: bool,
             heading_override: Optional[list[list[str]]] = None) -> list[Chunk]:
    chunks: list[Chunk] = []
    for k, (s, e) in enumerate(spans):
        s, e = strip_span(doc.text, s, e)
        if e <= s:
            continue
        page, hp = doc.location(s)
        if heading_override is not None:
            hp = heading_override[k]
        body = doc.text[s:e]
        index_text = (" > ".join(hp) + "\n" + body) if (prepend and hp) else body
        chunks.append(Chunk(id="", index=0, start=s, end=e, text=body, index_text=index_text,
                            tokens=tok.count(body), page=page, heading_path=list(hp)))
    for i, c in enumerate(chunks):
        c.index = i
        c.id = f"C{i + 1}"
    return chunks
