from app.core.registry import Component, register

from ._base import ChunkParams, finalize, merge_small, pack, sentence_spans, token_windows


@register("chunker", "sentence", label="Sentence", order=3)
class SentenceChunker(Component):
    """Packs whole sentences (and list items) into chunks. Never cuts mid-sentence unless a sentence is too long."""

    Params = ChunkParams

    def chunk(self, doc, ctx):
        tok, p = ctx.tokenizer, self.p
        pieces = []
        for s, e in sentence_spans(doc.text, 0, len(doc.text)):
            if tok.count(doc.text[s:e]) > p.chunk_size_tokens:
                pieces.extend(token_windows(doc.text, s, e, tok, p.chunk_size_tokens))
            else:
                pieces.append((s, e))
        spans = pack(doc.text, pieces, tok, p.chunk_size_tokens, p.overlap_tokens)
        spans = merge_small(doc.text, spans, tok, p.min_chunk_tokens)
        return finalize(doc, spans, tok, p.prepend_heading_path)
