from itertools import groupby

from app.core.registry import Component, register

from ._base import ChunkParams, finalize, pack, recursive_split, sections


@register("chunker", "page", label="Page-based", order=6)
class PageChunker(Component):
    """One chunk per PDF page; pages larger than the size are split recursively. Markdown files fall back to sections."""

    Params = ChunkParams

    def chunk(self, doc, ctx):
        tok, p = ctx.tokenizer, self.p
        if doc.kind == "pdf" and any(b.page for b in doc.blocks):
            groups = []
            for _, bs in groupby(doc.blocks, key=lambda b: b.page):
                bs = list(bs)
                groups.append((bs[0].start, bs[-1].end))
        else:
            groups = sections(doc)
        spans = []
        for s, e in groups:
            if tok.count(doc.text[s:e]) <= p.chunk_size_tokens:
                spans.append((s, e))
            else:
                pieces = recursive_split(doc.text, s, e, tok, p.chunk_size_tokens, ["\n\n", "\n", ". ", " "])
                spans.extend(pack(doc.text, pieces, tok, p.chunk_size_tokens, p.overlap_tokens))
        return finalize(doc, spans, tok, p.prepend_heading_path)
