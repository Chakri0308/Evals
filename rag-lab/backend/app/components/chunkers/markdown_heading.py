from app.core.registry import Component, register

from ._base import ChunkParams, finalize, merge_small, pack, recursive_split, sections


@register("chunker", "heading_aware", label="Heading-aware", order=4)
class HeadingAwareChunker(Component):
    """Chunks within each heading section and never crosses a section boundary. Each chunk carries its heading path."""

    Params = ChunkParams
    version = 2

    def chunk(self, doc, ctx):
        tok, p = ctx.tokenizer, self.p
        seps = ["\n\n", "\n", ". ", " "]
        # Fold sections smaller than min_chunk_tokens (e.g. a bare "## 1. Voice and tone" heading
        # followed directly by a sub-heading) into the next section, so no heading-only chunks.
        secs, carry = [], None
        for s, e in sections(doc):
            if carry is not None:
                s, carry = carry, None
            if tok.count(doc.text[s:e]) < max(p.min_chunk_tokens, 1):
                carry = s
                continue
            secs.append((s, e))
        if carry is not None:
            secs = secs[:-1] + [(secs[-1][0], len(doc.text))] if secs else [(carry, len(doc.text))]
        spans = []
        for s, e in secs:
            pieces = recursive_split(doc.text, s, e, tok, p.chunk_size_tokens, seps)
            sec = pack(doc.text, pieces, tok, p.chunk_size_tokens, p.overlap_tokens)
            spans.extend(merge_small(doc.text, sec, tok, p.min_chunk_tokens))
        return finalize(doc, spans, tok, p.prepend_heading_path)
