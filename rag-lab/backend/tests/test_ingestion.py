"""Parsing and chunking: heading paths, chunk sizes, overlap, section boundaries."""

import pytest

from app.core.registry import create

from .helpers import Ctx as _Ctx


# ------------------------------------------------------------- parsing
def test_markdown_parser_keeps_heading_paths(doc):
    heads = [b for b in doc.blocks if b.kind == "heading"]
    assert heads[0].heading_path == ["Lumen Docs Style Guide"]
    num = next(b for b in doc.blocks if "Spell out numbers" in doc.text[b.start:b.end])
    assert num.heading_path[-1] == "2.2 Numbers"


# ------------------------------------------------------------- chunkers
@pytest.mark.parametrize("name", ["fixed_token", "recursive", "sentence", "heading_aware", "page"])
@pytest.mark.parametrize("size,overlap", [(64, 0), (128, 16), (256, 64)])
def test_chunk_size_respected(doc, tok, name, size, overlap):
    ch = create("chunker", name, {"chunk_size_tokens": size, "overlap_tokens": overlap, "min_chunk_tokens": 0})
    chunks = ch.chunk(doc, _Ctx(doc, tok))
    assert chunks
    for c in chunks:
        assert c.tokens <= size + 2, (name, c.tokens)  # +2: BPE boundary effects after whitespace strip
        assert doc.text[c.start:c.end] == c.text
    # chunks are in document order and cover the text
    assert [c.start for c in chunks] == sorted(c.start for c in chunks)
    covered = sum(c.end - c.start for c in chunks)
    assert covered >= len(doc.text.strip()) * 0.9


def test_fixed_token_overlap_exact(doc, tok):
    ch = create("chunker", "fixed_token", {"chunk_size_tokens": 100, "overlap_tokens": 20, "min_chunk_tokens": 0})
    chunks = ch.chunk(doc, _Ctx(doc, tok))
    for a, b in zip(chunks, chunks[1:]):
        assert b.start < a.end, "consecutive fixed-token chunks must overlap"
        shared = tok.count(doc.text[b.start:a.end])
        assert 15 <= shared <= 22


def test_zero_overlap_no_shared_text(doc, tok):
    ch = create("chunker", "recursive", {"chunk_size_tokens": 128, "overlap_tokens": 0, "min_chunk_tokens": 0})
    chunks = ch.chunk(doc, _Ctx(doc, tok))
    for a, b in zip(chunks, chunks[1:]):
        assert b.start >= a.end


def test_overlap_capped_at_half():
    from app.components.chunkers._base import ChunkParams

    assert ChunkParams(chunk_size_tokens=100, overlap_tokens=90).overlap_tokens == 50


def test_heading_aware_never_crosses_sections(doc, tok):
    ch = create("chunker", "heading_aware", {"chunk_size_tokens": 512, "overlap_tokens": 0})
    import re

    for c in ch.chunk(doc, _Ctx(doc, tok)):
        # body text from at most one section: earlier sections in a chunk may only be bare (folded) headings
        parts = re.split(r"(?m)^#{1,6} .*$", c.text)
        assert all(not x.strip() for x in parts[:-1]), c.text[:200]
        assert c.index_text.startswith(" > ".join(c.heading_path))
