from app.core.registry import Component, register

from ._base import ChunkParams, finalize, merge_small, token_windows


@register("chunker", "fixed_token", label="Fixed token", order=1)
class FixedTokenChunker(Component):
    """Slides a fixed-size token window with overlap. Ignores structure entirely."""

    Params = ChunkParams

    def chunk(self, doc, ctx):
        tok = ctx.tokenizer
        p = self.p
        spans = token_windows(doc.text, 0, len(doc.text), tok, p.chunk_size_tokens, p.overlap_tokens)
        spans = merge_small(doc.text, spans, tok, p.min_chunk_tokens) if len(spans) > 1 else spans
        return finalize(doc, spans, tok, p.prepend_heading_path)
