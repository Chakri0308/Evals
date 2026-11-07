"""Why is this a good test question? Deterministic diagnostics for every generated question (no LLM needed).

For each question we measure, against the same chunks the panes use:

* **Terminology map**: every content word in the question: does it appear verbatim in the answer passage,
  only elsewhere in the document (a distractor for keyword search), only as another word form (BM25 does not
  stem, so "contraction" ≠ "contractions"), or nowhere (pure paraphrase only semantic search can bridge)?
  Plus the answer passage's own key terms that the question did *not* use (the vocabulary gap).
* **Retrieval check**: the actual rank of the answer chunk under BM25, under semantic search (if embeddings
  are allowed) and under hybrid RRF of the two.
* **Verdict**: which component the question really tests (BM25 / semantic / hybrid / reranking / abstention /
  baseline), a plain-language "why", and what a failure would mean.

Set-level suggestions then pick the most telling questions per component and point out coverage gaps.
"""
from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from typing import Any, Optional

import numpy as np

from app.core.documents import get_chunkset
from app.core.indexes import bm25_index, bm25_tokenize, chunk_embeddings
from app.core.types import Document
from app.evaluation.metrics import gold_chunk_ids

NO_GOLD = {"unanswerable", "ambiguous", "false_premise"}
NEGATION = re.compile(r"\b(not|never|no|without|except|unless|avoid|don't|doesn't|isn't|aren't|can't|cannot|shouldn't|mustn't)\b", re.I)
IDENT = re.compile(r"\b[A-Z]{2,}[-_]?\d+\b|\b\d[\d,.:%]*\b|\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)+\b|\"[^\"]{3,40}\"|'[^']{3,40}'")
RRF_K = 60
# words that frame a question rather than carry its meaning: excluded from the terminology map
FILLER = set(["according", "about", "regarding", "say", "says", "said", "tell", "tells", "explain", "describe", "guide", "guide's", "guides", "document", "docs", "doc", "rule", "rules", "policy", "advice", "dealing", "follow", "following", "what's", "whats", "which", "what", "when", "where", "how", "why", "who", "whom", "whose", "much", "many", "get", "got", "give", "gives", "need", "needs", "want", "wants", "should", "would", "could", "might", "must", "may", "also", "please", "plain", "terms", "term", "mean", "means", "meaning", "thing", "things", "way", "ways", "kind", "sort", "okay", "allowed", "allow", "there", "here", "this", "that", "these", "those", "does", "did", "done", "do", "make", "makes", "use", "used", "using", "write", "writing", "written"])

# what each generator category is *meant* to test (used to flag questions that don't do their job)
INTENDED = {"paraphrase": "semantic", "exact_term": "bm25", "numerical": "bm25",
            "unanswerable": "abstention", "false_premise": "abstention"}

TARGET_INFO = {
    "bm25": {"label": "BM25 test", "tests": "keyword (BM25) retrieval"},
    "semantic": {"label": "Semantic test", "tests": "semantic (embedding) retrieval"},
    "hybrid": {"label": "Hybrid test", "tests": "hybrid fusion of BM25 + semantic"},
    "hard": {"label": "Hard for all", "tests": "query rewriting, reranking or chunking"},
    "baseline": {"label": "Baseline", "tests": "the whole pipeline (sanity check)"},
    "abstention": {"label": "Abstention", "tests": "whether the answer step declines instead of inventing"},
    "reasoning": {"label": "Reasoning", "tests": "multi-chunk recall and the answer step"},
}


def _stem(w: str) -> str:
    for suf in ("ations", "ation", "ings", "ing", "ions", "ion", "ies", "ied", "es", "ed", "ly", "s"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def _rank(scores: np.ndarray, gold_idx: set[int]) -> Optional[int]:
    if not gold_idx:
        return None
    order = np.argsort(-scores, kind="stable")
    for r, i in enumerate(order, 1):
        if int(i) in gold_idx:
            return r
    return None


class _Ctx:
    """Everything shared across questions: chunks, BM25 index, vocab stats, optional embeddings."""

    def __init__(self, doc: Document, chunking: dict, embedding_model: Optional[str]):
        self.doc = doc
        self.cs, _ = get_chunkset(doc, chunking.get("component", "heading_aware"), chunking.get("params", {}),
                                  chunking.get("enabled", True))
        self.chunks = self.cs.chunks
        self.n = len(self.chunks)
        self.bm25, _ = bm25_index(self.cs, "okapi", 1.5, 0.75, True)
        self.toks = [set(bm25_tokenize(c.index_text)) for c in self.chunks]
        self.df: Counter = Counter(t for ts in self.toks for t in ts)
        self.doc_count: Counter = Counter(bm25_tokenize(doc.text))
        self.by_stem: dict[str, set[str]] = defaultdict(set)
        for w in self.df:
            self.by_stem[_stem(w)].add(w)
        self.emb = self.vecs = None
        self.dense_note = ""
        self.embedding_model = embedding_model
        self._init_dense(embedding_model)

    def idf(self, t: str) -> float:
        d = self.df.get(t, 0)
        return math.log((self.n - d + 0.5) / (d + 0.5) + 1)

    def _init_dense(self, spec: Optional[str]):
        from app.core import embeddings

        try:
            spec = embeddings.resolve_spec(spec)
            self.embedding_model = spec
            emb, name, params = embeddings.make(spec)
            ok, why = emb.ready()
            if not ok:
                self.dense_note = f"semantic rank not measured: {why}"
                return
            _, self.vecs, _ = chunk_embeddings(self.cs, name, params)
            self.emb = emb
        except Exception as e:  # noqa: BLE001
            self.dense_note = f"semantic rank not measured: {type(e).__name__}: {e}"

    def sections_with(self, t: str, exclude: set[int]) -> list[str]:
        out = []
        for i, ts in enumerate(self.toks):
            if t in ts and i not in exclude:
                hp = self.chunks[i].heading_path
                lab = hp[-1] if hp else self.chunks[i].id
                if lab not in out:
                    out.append(lab)
        return out


def _terms(question: str) -> list[str]:
    seen, out = set(), []
    for t in bm25_tokenize(question):
        if len(t) > 2 and t not in seen and t not in FILLER and t.rstrip("'s") not in FILLER:
            seen.add(t)
            out.append(t)
    return out


def analyze_item(cx: _Ctx, item: dict, qvec: Optional[np.ndarray]) -> dict:
    q = item.get("question", "")
    cat = item.get("category", "")
    spans = item.get("gold_spans") or []
    gold_ids = set(gold_chunk_ids(cx.chunks, spans))
    gold_idx = {i for i, c in enumerate(cx.chunks) if c.id in gold_ids}
    gold_quote_toks = set(t for s in spans for t in bm25_tokenize(s.get("quote", "")))
    gold_chunk_toks = set().union(*(cx.toks[i] for i in gold_idx)) if gold_idx else set()
    gold_sections = sorted({" > ".join(s.get("heading_path", [])[-1:]) for s in spans if s.get("heading_path")})

    # ---- terminology map
    terms = []
    for t in _terms(q):
        df = cx.df.get(t, 0)
        if t in gold_quote_toks:
            status = "gold"
        elif t in gold_chunk_toks:
            status = "gold_section"
        elif df:
            status = "elsewhere"
        else:
            variants = sorted(cx.by_stem.get(_stem(t), set()) - {t})
            status = "variant" if variants else "absent"
        row = {"term": t, "status": status, "chunks": df, "occurrences": cx.doc_count.get(t, 0),
               "idf": round(cx.idf(t), 2)}
        if status == "variant":
            row["variants"] = sorted(cx.by_stem[_stem(t)] - {t})[:3]
        if status in ("elsewhere", "gold", "gold_section"):
            others = cx.sections_with(t, gold_idx)
            if others:
                row["also_in"] = others[:4]
                row["also_in_count"] = len(others)
        terms.append(row)

    q_set = {r["term"] for r in terms}
    gap = sorted((t for t in gold_quote_toks if t not in q_set and len(t) > 3 and not any(
        _stem(t) == _stem(x) for x in q_set)), key=lambda t: -cx.idf(t))[:6]
    w_all = sum(r["idf"] for r in terms) or 1.0
    overlap = round(sum(r["idf"] for r in terms if r["status"] in ("gold", "gold_section")) / w_all, 2) if gold_idx else None
    identifiers = [m.group(0).strip("\"'") for m in IDENT.finditer(q)]
    identifiers = [x for x in identifiers if x.lower() in cx.doc.text.lower()
                   and not re.fullmatch(r"\d+(\.\d+)*\.?", x.strip().rstrip("."))][:4]  # skip section numbers

    # ---- retrieval check
    bm_scores = cx.bm25.get_scores(bm25_tokenize(q))
    b_rank = _rank(np.asarray(bm_scores), gold_idx)
    d_rank = None
    if qvec is not None and cx.vecs is not None:
        d_rank = _rank(cx.vecs @ qvec, gold_idx)
    h_rank = None
    if gold_idx and d_rank is not None:
        bo = {int(i): r for r, i in enumerate(np.argsort(-np.asarray(bm_scores), kind="stable"), 1)}
        do = {int(i): r for r, i in enumerate(np.argsort(-(cx.vecs @ qvec), kind="stable"), 1)}
        rrf = np.array([1 / (RRF_K + bo[i]) + 1 / (RRF_K + do[i]) for i in range(cx.n)])
        h_rank = _rank(rrf, gold_idx)
    top_distractor = None
    if gold_idx:
        best_other = max((i for i in range(cx.n) if i not in gold_idx), key=lambda i: bm_scores[i], default=None)
        if best_other is not None and bm_scores[best_other] > 0:
            hp = cx.chunks[best_other].heading_path
            top_distractor = {"chunk": cx.chunks[best_other].id, "section": hp[-1] if hp else "",
                              "beats_gold": b_rank is not None and b_rank > 1}

    # ---- verdict
    reasons: list[str] = []
    gold_terms = [r["term"] for r in terms if r["status"] in ("gold", "gold_section")]
    absent = [r["term"] for r in terms if r["status"] == "absent"]
    variant = [r for r in terms if r["status"] == "variant"]
    distract = [r for r in terms if r["status"] == "elsewhere" and r["chunks"] >= 2]
    neg = bool(NEGATION.search(q))
    multi = len({tuple(s.get("heading_path", [])) for s in spans}) > 1
    est = d_rank is None

    if not gold_idx or cat in NO_GOLD:
        target = "abstention"
        reasons.append("No passage in the document answers this, so every retriever will still return *something*. "
                       "The real test is whether the answer says it doesn't know instead of inventing one.")
        if gold_terms or distract:
            reasons.append(f"It reuses document words ({', '.join((gold_terms + [r['term'] for r in distract])[:4])}), "
                           "so retrieval will look confident, which makes the trap more realistic.")
    else:
        if est:
            # semantic rank unknown (embeddings off): decide from the measured BM25 rank + wording
            b = b_rank or 99
            if b <= 2 and (overlap or 0) >= 0.4:
                target = "bm25"
            elif b >= 5 or (overlap is not None and overlap <= 0.25):
                target = "semantic"
            elif b <= 2:
                target = "baseline"
            else:
                target = "hybrid"
        else:
            b, d, h = b_rank or 99, d_rank or 99, h_rank or 99
            if b <= 2 and d <= 2:
                target = "baseline"
            elif b <= 2 and d >= 4:
                target = "bm25"
            elif d <= 2 and b >= 4:
                target = "semantic"
            elif h <= 3 and b > 3 and d > 3:
                target = "hybrid"
            elif b > 5 and d > 5:
                target = "hard"
            elif b < d:
                target = "bm25"
            elif d < b:
                target = "semantic"
            else:
                target = "hybrid"
        if target in ("baseline", "hybrid") and (multi or cat in ("multi_hop", "comparison", "list_aggregation", "summarization")):
            target = "reasoning"

        # why: measured ranks first, then wording evidence
        if not est:
            reasons.append(f"Measured on your chunks: BM25 puts the answer at #{b_rank}, semantic search at #{d_rank}"
                           f"{f', hybrid RRF at #{h_rank}' if h_rank else ''} (of {cx.n} chunks).")
        else:
            reasons.append(f"Measured on your chunks: BM25 puts the answer at #{b_rank} of {cx.n}. Semantic rank "
                           "isn't measured while embeddings are off.")
        if gold_terms:
            reasons.append(f"Shared wording with the answer passage: {', '.join(gold_terms[:6])}"
                           f" ({int((overlap or 0) * 100)}% of the question's term weight).")
        else:
            reasons.append("The question shares no content words with the answer passage, so keyword search has "
                           "nothing to latch on to.")
        if absent:
            reasons.append(f"{', '.join(absent[:4])} never appear in the document. Only meaning (embeddings) can "
                           "connect them to the answer.")
        for r in variant[:2]:
            reasons.append(f"'{r['term']}' only appears as {', '.join(r['variants'])}. BM25 doesn't stem, so it "
                           "won't count that as a match. Semantic search will.")
        if gap:
            reasons.append(f"The passage itself says {', '.join(gap[:4])}: words the question avoided.")
        if distract:
            d0 = distract[0]
            reasons.append(f"'{d0['term']}' appears in {d0['chunks']} other chunks"
                           f"{' (e.g. ' + ', '.join(d0.get('also_in', [])[:2]) + ')' if d0.get('also_in') else ''}, "
                           "a keyword distractor.")
        if top_distractor and top_distractor["beats_gold"]:
            reasons.append(f"BM25's top hit is {top_distractor['chunk']} ({top_distractor['section']}), not the answer.")
        if identifiers:
            reasons.append(f"Exact identifier(s) {', '.join(identifiers)}: rare literal strings are BM25's home ground.")
        if neg:
            reasons.append("Contains a negation. Retrievers ignore 'not'/'never', so the answer step must get the "
                           "polarity right.")
        if multi:
            reasons.append(f"The answer spans {len(gold_sections) or 2} sections, so top_k and reranking decide "
                           "whether both parts reach the prompt.")
        if est and cx.dense_note:
            reasons.append(f"Verdict estimated without a semantic rank ({cx.dense_note.split(': ', 1)[-1]}).")

    headline = {
        "bm25": "Good BM25 check: the exact words carry it" + (f" (BM25 #{b_rank})" if est else f" (#{b_rank} vs semantic #{d_rank})"),
        "semantic": "Good semantic-search check: it's about meaning, not shared words"
                    + (f" (BM25 only #{b_rank})" if est else f" (#{d_rank} vs BM25 #{b_rank})"),
        "hybrid": "Good hybrid check: each method alone is weak, together they find it"
                  + (f" (RRF #{h_rank})" if h_rank else ""),
        "hard": "Hard for every retriever: a stress test" + ("" if est else f" (BM25 #{b_rank}, semantic #{d_rank})"),
        "baseline": "Sanity baseline: every method should get this right" + (f" (BM25 #{b_rank})" if est and b_rank else ""),
        "reasoning": "Tests multi-chunk recall and the answer step",
        "abstention": "Tests abstention: there is no right passage",
    }[target]
    if_fails = {
        "bm25": "If the BM25 pane misses it, check tokenisation/stopwords or chunking. If semantic misses it, "
                "that's expected: rare literal terms are where embeddings are weakest (use hybrid).",
        "semantic": "If the semantic pane misses it, the embedding model or chunk size is the problem. A BM25 miss "
                    "is expected here; it's the reason hybrid exists.",
        "hybrid": "If hybrid misses it, tune the fusion (RRF k or alpha) or raise candidate_k for both retrievers.",
        "hard": "Try a query rewrite (multi-query / HyDE), a cross-encoder reranker, or smaller chunks, then re-run.",
        "baseline": "A miss here means something basic is broken (chunking, index, top_k). Investigate first.",
        "reasoning": "If parts of the answer are missing, raise top_k, add a reranker or check the context filter's "
                     "token budget.",
        "abstention": "If a pane answers confidently, tighten the prompt's 'say I don't know' rule or add a "
                      "similarity threshold.",
    }[target]
    # does the question do the job its category promises?
    mismatch = None
    want = INTENDED.get(cat)
    if want and target != want and not (want == "bm25" and target == "baseline" and (b_rank or 99) <= 1):
        copied = [r["term"] for r in terms if r["status"] in ("gold", "gold_section")]
        if want == "semantic":
            mismatch = (f"Labelled '{cat.replace('_', ' ')}', but it reuses the passage's own words"
                        f"{' (' + ', '.join(copied[:4]) + ')' if copied else ''}, so keyword search finds it too and it "
                        "won't separate semantic from BM25. Reword those terms with synonyms (or use LLM mode) to make "
                        "it a real semantic test.")
        elif want == "bm25":
            mismatch = (f"Labelled '{cat.replace('_', ' ')}', but BM25 doesn't rank the answer first (#{b_rank}). Add the "
                        "exact term, code or number from the passage to make it a real keyword test.")
        else:
            mismatch = f"Labelled '{cat.replace('_', ' ')}', but the measured behaviour looks like a {TARGET_INFO[target]['label'].lower()}."
    return {
        "target": target, "label": TARGET_INFO[target]["label"], "tests": TARGET_INFO[target]["tests"],
        "category_mismatch": mismatch,
        "headline": headline, "reasons": reasons, "if_fails": if_fails, "estimated": est and target != "abstention",
        "terms": terms, "gap_terms": gap, "overlap": overlap, "identifiers": identifiers, "negation": neg,
        "gold_chunks": sorted(gold_ids), "gold_sections": gold_sections,
        "ranks": {"bm25": b_rank, "semantic": d_rank, "hybrid": h_rank, "of": cx.n},
        "top_distractor": top_distractor,
    }


def suggestions(items: list[dict], analyses: dict[str, dict]) -> dict[str, Any]:
    rows = [(it, analyses[it["id"]]) for it in items if it.get("id") in analyses]

    def pick(fn, key, n=5):
        cand = [(it, a) for it, a in rows if fn(a)]
        cand.sort(key=key)
        return [{"id": it["id"], "question": it["question"], "label": a["label"], "ranks": a["ranks"],
                 "why": a["headline"]} for it, a in cand[:n]]

    def r(a, k):
        v = a["ranks"].get(k)
        return v if v is not None else 99

    groups = [
        {"id": "semantic", "title": "Best checks for semantic-search accuracy",
         "hint": "Semantic finds the answer, BM25 doesn't. The bigger the gap, the better the check.",
         "items": pick(lambda a: a["target"] == "semantic", lambda x: (r(x[1], "semantic") - r(x[1], "bm25"), r(x[1], "semantic")))},
        {"id": "bm25", "title": "Best BM25 / exact-term checks",
         "hint": "Exact words or identifiers carry these. Semantic search tends to rank them lower.",
         "items": pick(lambda a: a["target"] == "bm25", lambda x: (r(x[1], "bm25") - r(x[1], "semantic"), r(x[1], "bm25")))},
        {"id": "hybrid", "title": "Where hybrid earns its keep",
         "hint": "Neither method alone ranks the answer high, but fused they do.",
         "items": pick(lambda a: a["target"] == "hybrid", lambda x: r(x[1], "hybrid"))},
        {"id": "hard", "title": "Stress tests (hard for everything)",
         "hint": "Use these to judge query rewriting, reranking or chunking changes.",
         "items": pick(lambda a: a["target"] == "hard", lambda x: -(r(x[1], "bm25") + r(x[1], "semantic")))},
        {"id": "abstention", "title": "Hallucination traps",
         "hint": "No passage answers these. A good pipeline says it doesn't know.",
         "items": pick(lambda a: a["target"] == "abstention", lambda x: 0)},
        {"id": "baseline", "title": "Sanity baselines",
         "hint": "Every method should pass these. Run them after any change.",
         "items": pick(lambda a: a["target"] in ("baseline", "reasoning"), lambda x: r(x[1], "bm25") + r(x[1], "semantic"), 3)},
    ]
    counts = Counter(a["target"] for _, a in rows)
    advice = []
    mism = [it for it, a in rows if a.get("category_mismatch")]
    if mism:
        advice.append(f"{len(mism)} question(s) don't test what their category promises (marked ⚠ in the table), "
                      "e.g. 'paraphrase' questions that copy the section's words. Edit them or regenerate in LLM mode.")
    if not counts.get("semantic"):
        advice.append("No question where semantic search beats BM25 yet. Generate more 'Paraphrased / lexical "
                      "mismatch' or 'Negation' questions (LLM mode paraphrases best).")
    if not counts.get("bm25"):
        advice.append("No question where BM25 clearly wins. Add 'Exact-term lookup' or 'Numerical' questions "
                      "(codes, numbers, product names).")
    if not counts.get("abstention"):
        advice.append("No hallucination traps. Add 'Unanswerable' or 'False premise' questions.")
    if counts.get("baseline", 0) > 0.6 * max(1, len(rows)):
        advice.append("Most questions are easy for every method, so they won't separate your configs. Ask for "
                      "more paraphrase, multi-hop and exception questions.")
    return {"groups": [g for g in groups if g["items"]], "counts": dict(counts), "advice": advice}


def analyze(doc: Document, items: list[dict], chunking: Optional[dict] = None,
            embedding_model: Optional[str] = None) -> dict[str, Any]:
    chunking = chunking or {"component": "heading_aware", "params": {"chunk_size_tokens": 256, "overlap_tokens": 32}}
    cx = _Ctx(doc, chunking, embedding_model)
    qvecs: dict[str, np.ndarray] = {}
    if cx.emb is not None:
        qs = [it for it in items if it.get("question")]
        for it in qs:
            qvecs[it["id"]] = cx.emb.embed_query(it["question"])
    analyses = {it["id"]: analyze_item(cx, it, qvecs.get(it["id"])) for it in items if it.get("id")}
    return {"analyses": analyses, "suggestions": suggestions(items, analyses),
            "context": {"chunks": cx.n, "chunker": chunking.get("component"), "embedding_model": cx.embedding_model,
                        "semantic_measured": cx.emb is not None, "note": cx.dense_note}}
