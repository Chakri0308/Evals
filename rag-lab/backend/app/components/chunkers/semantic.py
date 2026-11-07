import numpy as np
from pydantic import Field

from app.core.registry import Component, create, register

from ._base import ChunkParams, finalize, sentence_spans, token_windows


class SemanticParams(ChunkParams):
    breakpoint_percentile: int = Field(20, ge=1, le=60, description="Split where neighbour similarity falls below this percentile")
    embedder: str = Field("sentence_transformers", description="Embedder used to compare sentences")


@register("chunker", "semantic", label="Semantic", order=5)
class SemanticChunker(Component):
    """Embeds each sentence and splits where the similarity between neighbouring sentences drops."""

    Params = SemanticParams

    def chunk(self, doc, ctx):
        tok, p = ctx.tokenizer, self.p
        sents = []
        for s, e in sentence_spans(doc.text, 0, len(doc.text)):
            if tok.count(doc.text[s:e]) > p.chunk_size_tokens:
                sents.extend(token_windows(doc.text, s, e, tok, p.chunk_size_tokens))
            else:
                sents.append((s, e))
        if len(sents) <= 1:
            return finalize(doc, sents, tok, p.prepend_heading_path)
        emb = create("embedder", p.embedder, {})
        ok, why = emb.ready()
        if not ok:
            from app.core.settings import Unavailable

            raise Unavailable(f"semantic chunking needs embeddings: {why}", what="embeddings")
        vecs = emb.embed_documents([doc.text[s:e] for s, e in sents])
        sims = np.sum(vecs[:-1] * vecs[1:], axis=1)
        thr = float(np.percentile(sims, p.breakpoint_percentile))
        spans, cs = [], sents[0][0]
        ce = sents[0][1]
        for i in range(1, len(sents)):
            s, e = sents[i]
            too_big = tok.count(doc.text[cs:e]) > p.chunk_size_tokens
            if (sims[i - 1] < thr or too_big) and (too_big or tok.count(doc.text[cs:ce]) >= p.min_chunk_tokens):
                spans.append((cs, ce))
                cs = s
            ce = e
        spans.append((cs, ce))
        return finalize(doc, spans, tok, p.prepend_heading_path)
