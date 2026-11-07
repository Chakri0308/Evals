"""BM25, dense search, fusion math, and semantic search on paraphrased questions."""
import asyncio

import pytest

from app.core.registry import create
from app.core.types import Hit, QueryBundle, RetrievalOutput

from .helpers import Ctx as _Ctx
from .helpers import chunkset as _cs


# ------------------------------------------------------------- retrieval / fusion
def test_bm25_exact_term_ranks_first(doc, tok):
    from app.core.types import QueryBundle
    cs = _cs(doc, tok)
    r = create("retriever", "bm25", {"candidate_k": 10})
    out = asyncio.run(r.retrieve(QueryBundle(original="q", queries=["Project Halcyon code name"], dense_queries=["x"]),
                                 cs, _Ctx(doc, tok)))
    top = cs.by_id()[out.lists["bm25"][0].chunk_id]
    assert "Halcyon" in top.text
    scores = [h.scores["bm25"] for h in out.lists["bm25"]]
    assert scores == sorted(scores, reverse=True)
def test_rrf_fusion_math():
    out = RetrievalOutput(lists={
        "bm25": [Hit(chunk_id="A", scores={"bm25": 9}), Hit(chunk_id="B", scores={"bm25": 5})],
        "dense": [Hit(chunk_id="B", scores={"dense": .9}), Hit(chunk_id="C", scores={"dense": .8})],
    })
    fused = create("fuser", "rrf", {"k": 60}).fuse(out)
    assert fused[0].chunk_id == "B"  # appears in both lists
    assert fused[0].scores["fused"] == pytest.approx(1 / 62 + 1 / 61, rel=1e-4)
    assert {h.chunk_id for h in fused} == {"A", "B", "C"}
@pytest.mark.parametrize("alpha,winner", [(0.0, "A"), (1.0, "C")])
def test_weighted_fusion_alpha_extremes(alpha, winner):
    out = RetrievalOutput(lists={
        "bm25": [Hit(chunk_id="A", scores={"bm25": 10}), Hit(chunk_id="B", scores={"bm25": 1})],
        "dense": [Hit(chunk_id="C", scores={"dense": .9}), Hit(chunk_id="B", scores={"dense": .1})],
    })
    fused = create("fuser", "weighted", {"alpha": alpha}).fuse(out)
    assert fused[0].chunk_id == winner
def test_dense_ranking_paraphrase(doc, tok):
    from app.components.retrievers._common import dense_search
    cs = _cs(doc, tok)
    hits, _ = asyncio.run(dense_search(["how do I describe pictures for blind users"], cs, 5,
                                       "local:BAAI/bge-small-en-v1.5", 0.0))
    top_texts = " ".join(cs.by_id()[h.chunk_id].text for h in hits[:3])
    assert "alt text" in top_texts
    sims = [h.scores["dense"] for h in hits]
    assert sims == sorted(sims, reverse=True)


@pytest.mark.parametrize("question,gold", [
    ("How do I describe pictures for blind users?", "alt text"),
    ("How often do we ship the changelog?", "every second Tuesday"),
    ("How much warning must we give before removing a feature?", "90 days"),
    ("What's the minimum readability ratio between text and background?", "4.5:1"),
])
def test_chroma_semantic_search_handles_paraphrase(doc, tok, question, gold):
    """Questions share almost no words with the answer; the vector DB still returns the right chunk first."""
    r = create("retriever", "dense", {"top_k": 5})
    out = asyncio.run(r.retrieve(QueryBundle(original=question, queries=[question], dense_queries=[question]),
                                 _cs(doc, tok), _Ctx(doc, tok)))
    top = _cs(doc, tok).by_id()[out.lists["dense"][0].chunk_id].text
    assert gold in top
