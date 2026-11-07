"""Retrieval metrics, gold-span location, question generation and question analysis."""
import asyncio

import pytest


# ------------------------------------------------------------- metrics
def test_metrics():
    from app.core.types import Chunk
    from app.evaluation.metrics import hit_at_k, mrr, ndcg_at_k, recall_at_k

    ranked = ["C3", "C1", "C7"]
    gold = {"C1", "C9"}
    assert hit_at_k(ranked, gold, 1) == 0.0
    assert hit_at_k(ranked, gold, 2) == 1.0
    assert mrr(ranked, gold) == pytest.approx(0.5)
    import math
    assert ndcg_at_k(ranked, gold, 3) == pytest.approx((1 / math.log2(3)) / (1 + 1 / math.log2(3)))
    def mk(i, s, e):
        return Chunk(id=i, index=0, start=s, end=e, text="", index_text="", tokens=1)
    chunks = [mk("C1", 0, 10), mk("C2", 10, 20)]
    spans = [{"start": 5, "end": 8}, {"start": 50, "end": 60}]
    assert recall_at_k(chunks, spans, 2) == 0.5


def test_gold_span_locate(doc):
    from app.qgen.generator import locate

    sp = locate(doc, "Keep alt text under 125 characters.")
    assert sp and sp["match"] == "exact" and "5.1" in sp["heading_path"][-1]
    sp2 = locate(doc, "keep   ALT text under 125 characters")
    assert sp2 and sp2["match"] == "normalized"
    assert locate(doc, "The moon is made of cheese and nobody disputes it.") is None


def test_heuristic_qgen_all_categories(doc):
    from app.qgen.categories import CATEGORIES
    from app.qgen.generator import generate

    items = asyncio.run(generate(doc, {c["id"]: 1 for c in CATEGORIES}, mode="heuristic"))
    cats = {i["category"] for i in items}
    assert len(cats) == 16
    for i in items:
        if i["category"] not in ("unanswerable", "ambiguous"):
            assert i["gold_spans"], i


# ------------------------------------------------------------- question analysis ("why is this a good test?")
def _qa_items(doc):
    from app.qgen.generator import revalidate

    def item(i, cat, q, quote):
        return revalidate(doc, {"id": i, "category": cat, "question": q, "gold_spans": [],
                                "invalid_quotes": [quote] if quote else [], "expected_answer": ""})
    return [
        item("sem", "paraphrase", "How much heads-up do customers get before a feature is removed?",
             "Deprecation notices must give at least 90 days of notice"),
        item("joke", "paraphrase", "Can I tell a joke or make a pun in the docs?", "Avoid jokes, puns, and pop-culture references"),
        item("code", "exact_term", "What is error code LMN-2207 about?",
             'Include the error code at the end in parentheses, for example "(LMN-2207)"'),
        item("none", "unanswerable", "Which font size does the guide require for slide presentations?", None),
        item("tmpl", "paraphrase", "In plain terms, what's the advice when dealing with 2.5 contractions?",
             "Contractions such as"),
    ]


def test_question_analysis_explains_targets(doc):
    from app.qgen.analysis import analyze

    out = analyze(doc, _qa_items(doc))
    a = out["analyses"]
    assert out["context"]["semantic_measured"]
    sem = a["sem"]
    assert sem["target"] == "semantic" and sem["ranks"]["semantic"] <= 2 and sem["ranks"]["bm25"] >= 5
    assert any("BM25 puts the answer" in r for r in sem["reasons"])
    joke = {t["term"]: t for t in a["joke"]["terms"]}
    assert joke["joke"]["status"] == "variant" and "jokes" in joke["joke"]["variants"]
    assert a["code"]["ranks"]["bm25"] == 1 and "LMN-2207" in a["code"]["identifiers"]
    assert {t["term"]: t["status"] for t in a["code"]["terms"]}["2207"] == "gold"
    assert a["none"]["target"] == "abstention"
    assert a["tmpl"]["category_mismatch"] and "contractions" in a["tmpl"]["category_mismatch"]
    assert "say" not in {t["term"] for t in a["tmpl"]["terms"]}  # question filler is not 'terminology'
    groups = {g["id"]: [x["id"] for x in g["items"]] for g in out["suggestions"]["groups"]}
    assert "sem" in groups["semantic"] and "none" in groups["abstention"]


def test_question_analysis_without_embeddings(doc, monkeypatch):
    from app.qgen.analysis import analyze

    monkeypatch.setenv("RAG_LAB_ALLOW_EMBEDDINGS", "false")
    out = analyze(doc, _qa_items(doc))
    assert not out["context"]["semantic_measured"]
    sem = out["analyses"]["sem"]
    assert sem["ranks"]["semantic"] is None and sem["estimated"]
    assert sem["target"] == "semantic"  # BM25 rank alone (#22 of 23) is enough evidence
