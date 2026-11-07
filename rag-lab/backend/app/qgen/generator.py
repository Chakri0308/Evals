"""Test-set generation: LLM (section by section) with a heuristic fallback, then gold-span validation."""
from __future__ import annotations

import asyncio
import json
import random
import re
import uuid
from collections import Counter
from collections.abc import Awaitable, Callable
from typing import Any, Optional

from app.components.chunkers._base import sections, sentence_spans
from app.components.judges.heuristic import token_f1
from app.core.indexes import STOPWORDS, bm25_tokenize
from app.core.types import Document

from .categories import BY_ID, CATEGORIES


# ---------------------------------------------------------------- gold-span validation
def _norm_map(text: str) -> tuple[str, list[int]]:
    """Lowercase + collapse whitespace + drop markdown emphasis; keep a map back to original offsets."""
    out, idx, prev_space = [], [], False
    for i, ch in enumerate(text):
        if ch in "*_`":
            continue
        if ch.isspace():
            if prev_space:
                continue
            out.append(" ")
            prev_space = True
        else:
            out.append(ch.lower())
            prev_space = False
        idx.append(i)
    return "".join(out), idx


def locate(doc: Document, quote: str, hint_spans: Optional[list[tuple[int, int]]] = None) -> Optional[dict]:
    quote = (quote or "").strip().strip('"“”')
    if len(quote) < 8:
        return None
    i = doc.text.find(quote)
    if i >= 0:
        return _span(doc, i, i + len(quote), "exact")
    nt, m = _norm_map(doc.text)
    nq, _ = _norm_map(quote)
    nq = nq.strip()
    j = nt.find(nq)
    if j >= 0 and nq:
        return _span(doc, m[j], m[min(j + len(nq) - 1, len(m) - 1)] + 1, "normalized")
    # fuzzy: best sentence within the hinted sections (or the whole doc)
    regions = hint_spans or [(0, len(doc.text))]
    best, best_s = None, 0.0
    for s, e in regions:
        for ss, se in sentence_spans(doc.text, s, e):
            f = token_f1(quote, doc.text[ss:se])
            if f > best_s:
                best, best_s = (ss, se), f
    if best and best_s >= 0.5:
        return _span(doc, best[0], best[1], f"fuzzy({best_s:.2f})")
    return None


def _span(doc: Document, s: int, e: int, how: str) -> dict:
    page, hp = doc.location(s)
    return {"start": s, "end": e, "page": page, "heading_path": hp, "quote": doc.text[s:e], "match": how}


# ---------------------------------------------------------------- section helpers
def _section_list(doc: Document) -> list[dict]:
    out = []
    for s, e in sections(doc):
        page, hp = doc.location(s)
        body = doc.text[s:e].strip()
        sents = [(a, b) for a, b in sentence_spans(doc.text, s, e) if len(doc.text[a:b]) > 25
                 and not doc.text[a:b].lstrip().startswith("#")]
        if len(body) < 60 or not sents:
            continue
        out.append({"start": s, "end": e, "title": hp[-1] if hp else doc.name, "path": hp, "sents": sents})
    return out


def _pick(secs, k, rng, used: Counter):
    order = sorted(range(len(secs)), key=lambda i: (used[i], rng.random()))
    pick = order[:k]
    for i in pick:
        used[i] += 1
    return [secs[i] for i in pick]


# ---------------------------------------------------------------- heuristic generator
UNANSWERABLE = [
    "What does the guide recommend for formatting SQL queries in documentation?",
    "Which font size does the guide require for slide presentations?",
    "What is the guide's policy on emoji usage in legal contracts?",
    "How should video subtitles be timed according to the guide?",
    "What does the guide say about writing in Klingon?",
]


def _sent_with(doc, secs, pattern, rng):
    cands = []
    for sec in secs:
        for a, b in sec["sents"]:
            if re.search(pattern, doc.text[a:b], re.I):
                cands.append((sec, (a, b)))
    return rng.choice(cands) if cands else None


def _clean(t: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[*_`#>]", "", t)).strip(" -")


def heuristic_item(doc: Document, cat: str, secs, rng, used) -> Optional[dict]:
    t = doc.text
    if not secs:
        return None
    s1 = _pick(secs, 1, rng, used)[0]
    sent = rng.choice(s1["sents"])
    q = exp = None
    gold = [sent]
    notes = "heuristic template"
    title = s1["title"]
    if cat == "single_hop":
        q = f"According to the guide, what is the rule about {title.lower()}?"
        exp = _clean(t[sent[0]:sent[1]])
    elif cat in ("multi_hop", "comparison", "conflict", "list_aggregation"):
        a, b = _pick(secs, 2, rng, used) if len(secs) > 1 else (s1, s1)
        sa, sb = rng.choice(a["sents"]), rng.choice(b["sents"])
        gold = [sa, sb]
        ta, tb = a["title"].lower(), b["title"].lower()
        q = {"multi_hop": f"What do the guide's rules on {ta} and on {tb} together require of a writer?",
             "comparison": f"How does the guidance on {ta} differ from the guidance on {tb}?",
             "conflict": f"If the rules on {ta} and {tb} seem to conflict in the same sentence, which should take precedence?",
             "list_aggregation": f"List all the rules the guide gives about {ta} and {tb}."}[cat]
        exp = _clean(t[sa[0]:sa[1]]) + " / " + _clean(t[sb[0]:sb[1]])
    elif cat == "rule_application":
        r = _sent_with(doc, secs, r"\b(use|write|prefer|avoid|always|never|spell)\b", rng) or (s1, sent)
        s1, sent = r
        gold = [sent]
        q = f"Rewrite a sentence so that it follows this part of the guide ('{s1['title']}'). What rule must the rewrite apply?"
        exp = _clean(t[sent[0]:sent[1]])
    elif cat == "exception":
        r = _sent_with(doc, secs, r"\b(except|unless|however|exception|only when|but)\b", rng) or (s1, sent)
        s1, sent = r
        gold = [sent]
        q = f"When does the guidance on {s1['title'].lower()} not apply?"
        exp = _clean(t[sent[0]:sent[1]])
    elif cat in ("exact_term", "numerical"):
        if cat == "numerical":
            r = _sent_with(doc, secs, r"\d", rng)
        else:
            r = None
            counts = Counter(bm25_tokenize(t))
            rare = [(sec, sp) for sec in secs for sp in sec["sents"]
                    if any(counts[w] <= 2 and len(w) > 4 and w not in STOPWORDS for w in bm25_tokenize(t[sp[0]:sp[1]]))]
            if rare:
                r = rng.choice(rare)
        if not r:
            return None
        s1, sent = r
        gold = [sent]
        stext = t[sent[0]:sent[1]]
        if cat == "numerical":
            num = re.search(r"\d[\d,.%]*", stext).group()
            q = f"What specific number or limit ({num}) does the guide give in the section on {s1['title'].lower()}, and what does it apply to?"
        else:
            counts = Counter(bm25_tokenize(t))
            term = min((w for w in bm25_tokenize(stext) if len(w) > 4), key=lambda w: counts[w])
            m = re.search(re.escape(term), stext, re.I)
            q = f"What does the guide say about \"{m.group() if m else term}\"?"
        exp = _clean(stext)
    elif cat == "paraphrase":
        q = f"In plain terms, what's the advice I should follow when dealing with {title.lower()}?"
        exp = _clean(t[sent[0]:sent[1]])
        notes = "heuristic: paraphrase quality is limited; LLM mode gives better lexical mismatch"
    elif cat == "negation":
        r = _sent_with(doc, secs, r"\b(not|never|avoid|don't|do not)\b", rng) or (s1, sent)
        s1, sent = r
        gold = [sent]
        q = f"What should you NOT do regarding {s1['title'].lower()}?"
        exp = _clean(t[sent[0]:sent[1]])
    elif cat == "unanswerable":
        q, exp, gold = rng.choice(UNANSWERABLE), "I don't know: the guide does not cover this.", []
    elif cat == "false_premise":
        q = f"Why does the guide say the rules on {title.lower()} can be ignored in formal documents?"
        exp = "The guide does not say that; the premise is false."
        gold = [sent]
    elif cat == "ambiguous":
        q = f"What's the right way to do it for {title.split()[0].lower()}?"
        exp = "Ambiguous: should ask for clarification or cover the rules in: " + title
    elif cat == "summarization":
        q = f"Summarize the guidance in the '{title}' section."
        gold = s1["sents"][:3]
        exp = " ".join(_clean(t[a:b]) for a, b in gold)
    elif cat == "multi_turn":
        q1 = f"What does the guide say about {title.lower()}?"
        q = f"(Follow-up to: \"{q1}\") Are there any exceptions to that?"
        exp = _clean(t[sent[0]:sent[1]])
        notes = f"turn 1: {q1}"
    if not q:
        return None
    return {"question": q, "expected_answer": exp, "gold_quotes": [t[a:b] for a, b in gold],
            "difficulty": "hard" if cat in ("multi_hop", "conflict", "false_premise", "list_aggregation") else
            ("medium" if cat in ("comparison", "exception", "rule_application", "paraphrase", "negation") else "easy"),
            "notes": notes, "_hint": [(s1["start"], s1["end"])]}


# ---------------------------------------------------------------- LLM generator
async def llm_item(doc: Document, cat: str, secs, rng, used, llm) -> Optional[dict]:
    c = BY_ID[cat]
    picked = _pick(secs, c["sections"], rng, used) if secs else []
    if c["sections"] == 2 and len(picked) < 2:
        picked = picked * 2
    passages = "\n\n".join(f"Passage {'AB'[i]} (section: {' > '.join(p['path'])}):\n{doc.text[p['start']:p['end']][:2500]}"
                           for i, p in enumerate(picked))
    fmt = ('{"question": "...", "expected_answer": "...", "gold_quotes": ["exact sentence copied from a passage", ...], '
           '"difficulty": "easy|medium|hard", "notes": "..."' + (', "first_turn": "..."' if cat == "multi_turn" else "") + "}")
    user = (f"{passages}\n\nTask: create ONE test question of type '{c['label']}'.\n{c['instruction']}\n"
            f"gold_quotes must be sentences copied VERBATIM from the passages that support the answer"
            f"{' (use an empty list, since the answer is not in the passages)' if cat == 'unanswerable' else ''}.\n"
            f"Return JSON only: {fmt}")
    out = await llm.complete("You create evaluation datasets for retrieval-augmented generation over a style guide. "
                             "Output strict JSON.", user, json_mode=True)
    m = re.search(r"\{.*\}", out, re.S)
    d = json.loads(m.group() if m else out)
    q = str(d.get("question", "")).strip()
    if not q:
        return None
    if cat == "multi_turn" and d.get("first_turn"):
        q = f"(Follow-up to: \"{d['first_turn']}\") {q}"
    gq = d.get("gold_quotes") or []
    if isinstance(gq, str):
        gq = [gq]
    return {"question": q, "expected_answer": str(d.get("expected_answer", "")),
            "gold_quotes": [str(x) for x in gq][:4], "difficulty": str(d.get("difficulty", "medium")).lower(),
            "notes": str(d.get("notes", ""))[:300], "_hint": [(p["start"], p["end"]) for p in picked]}


# ---------------------------------------------------------------- orchestrator
async def generate(doc: Document, categories: dict[str, int], mode: str = "llm", llm_cfg: Optional[dict] = None,
                   seed: int = 7, progress: Optional[Callable[[dict], Awaitable[None]]] = None) -> list[dict]:
    rng = random.Random(seed)
    secs = _section_list(doc)
    used: Counter = Counter()
    llm = None
    llm_note = ""
    if mode == "llm":
        from app.core.providers import make_llm

        cfg = llm_cfg or {}
        llm = make_llm(cfg.get("provider"), cfg.get("model"), temperature=0.4, max_tokens=600)
        ok, why = llm.ready()
        if not ok:
            llm, llm_note = None, f"LLM unavailable ({why}); used heuristic templates"
    jobs = [(cat, i) for cat, n in categories.items() if cat in BY_ID for i in range(int(n))]
    total = len(jobs)
    sem = asyncio.Semaphore(2)
    done = 0
    items: list[dict] = []

    async def one(cat):
        nonlocal done
        async with sem:
            raw, src = None, "heuristic"
            if llm is not None:
                try:
                    raw = await llm_item(doc, cat, secs, rng, used, llm)
                    src = "llm"
                except Exception as e:  # noqa: BLE001
                    raw = None
                    src = f"heuristic (llm failed: {type(e).__name__})"
            if raw is None:
                raw = heuristic_item(doc, cat, secs, rng, used)
                if src == "llm":
                    src = "heuristic"
            done += 1
            if raw is None:
                if progress:
                    await progress({"done": done, "total": total})
                return
            item = finalize_item(doc, cat, raw, src)
            items.append(item)
            if progress:
                await progress({"done": done, "total": total, "item": item})

    await asyncio.gather(*(one(cat) for cat, _ in jobs))
    order = {c["id"]: i for i, c in enumerate(CATEGORIES)}
    items.sort(key=lambda x: (order.get(x["category"], 99), x["id"]))
    if llm_note:
        for it in items:
            it["notes"] = (it["notes"] + " · " + llm_note).strip(" ·")
    return items


def finalize_item(doc: Document, cat: str, raw: dict, source: str) -> dict:
    hint = raw.pop("_hint", None)
    spans, invalid = [], []
    for q in raw.get("gold_quotes", []):
        sp = locate(doc, q, hint)
        (spans.append(sp) if sp else invalid.append(q))
    c = BY_ID[cat]
    valid = cat in ("unanswerable", "ambiguous") or bool(spans)
    return {
        "id": uuid.uuid4().hex[:8], "category": cat, "question": raw["question"],
        "expected_answer": raw.get("expected_answer", ""), "gold_spans": spans,
        "difficulty": raw.get("difficulty", "medium") if raw.get("difficulty") in ("easy", "medium", "hard") else "medium",
        "what_it_stresses": c["stresses"], "notes": raw.get("notes", ""), "source": source,
        "valid": valid, "invalid_quotes": invalid,
    }


def revalidate(doc: Document, item: dict[str, Any]) -> dict:
    quotes = [g["quote"] for g in item.get("gold_spans", [])] + item.get("invalid_quotes", [])
    spans, invalid = [], []
    for q in quotes:
        sp = locate(doc, q)
        (spans.append(sp) if sp else invalid.append(q))
    item["gold_spans"], item["invalid_quotes"] = spans, invalid
    item["valid"] = item["category"] in ("unanswerable", "ambiguous") or bool(spans)
    return item
