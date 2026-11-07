from pydantic import Field

from app.core.registry import Component, register

from ._base import ChunkParams, finalize, merge_small, pack, recursive_split


class RecursiveParams(ChunkParams):
    separators: str = Field("\\n\\n|\\n|. |, | ", description="Separator hierarchy, '|' separated (\\n = newline)")


@register("chunker", "recursive", label="Recursive", order=2)
class RecursiveChunker(Component):
    """Splits on a separator hierarchy (paragraph, line, sentence, word), then packs the pieces up to the size."""

    Params = RecursiveParams

    def chunk(self, doc, ctx):
        tok, p = ctx.tokenizer, self.p
        seps = [s.replace("\\n", "\n") for s in p.separators.split("|") if s]
        pieces = recursive_split(doc.text, 0, len(doc.text), tok, p.chunk_size_tokens, seps)
        spans = pack(doc.text, pieces, tok, p.chunk_size_tokens, p.overlap_tokens)
        spans = merge_small(doc.text, spans, tok, p.min_chunk_tokens)
        return finalize(doc, spans, tok, p.prepend_heading_path)
