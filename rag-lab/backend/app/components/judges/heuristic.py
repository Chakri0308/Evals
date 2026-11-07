import re
from collections import Counter

from app.core.indexes import bm25_tokenize
from app.core.registry import Component, register

ABSTAIN = re.compile(r"\b(i (do not|don't|dont) know|not (mentioned|covered|specified|stated|addressed|provided)|"
                     r"(no|does not contain|doesn't contain) (information|mention)|cannot (find|answer|determine)|"
                     r"unable to (find|answer|determine)|isn't (covered|mentioned)|"
                     r"(does not|doesn't) (provide|mention|cover|say|specify|address|include|contain|state)|"
                     r"no (specific )?(guidance|rules?|instructions?) (on|about|for))\b", re.I)

RUBRIC = """correctness (1-5): how well the answer matches the expected answer (5 = fully correct).
faithfulness (1-5): is every claim supported by the retrieved context? (5 = fully grounded)
citation_accuracy (0-1): fraction of cited chunks that actually contain the gold evidence.
abstention: for unanswerable/false-premise questions, did the system correctly decline or push back?"""


def abstained(answer: str) -> bool:
    return bool(ABSTAIN.search(answer or ""))


def token_f1(a: str, b: str) -> float:
    ta, tb = Counter(bm25_tokenize(a)), Counter(bm25_tokenize(b))
    common = sum((ta & tb).values())
    if not common:
        return 0.0
    p, r = common / sum(ta.values()), common / sum(tb.values())
    return 2 * p * r / (p + r)


def citation_accuracy(cited, gold_hit_ids):
    if not cited or not gold_hit_ids:
        return None
    return round(len(set(cited) & set(gold_hit_ids)) / len(set(cited)), 3)


def expects_abstention(item) -> bool:
    return item.get("category") in ("unanswerable", "false_premise")


@register("judge", "heuristic", label="Heuristic (offline)", order=2)
class HeuristicJudge(Component):
    """Offline, deterministic scoring: token-F1 correctness, lexical groundedness, citation overlap and abstention regex."""

    rubric = RUBRIC

    async def judge(self, item, answer, context, cited, gold_hit_ids):
        ab = abstained(answer)
        exp_ab = expects_abstention(item)
        if exp_ab:
            correctness = 5.0 if ab else 1.0
        else:
            correctness = round(1 + 4 * min(1.0, token_f1(answer, item.get("expected_answer", "")) * 1.6), 2)
        ctx_toks = set(bm25_tokenize(" ".join(c.text for c in context)))
        ans_toks = bm25_tokenize(re.sub(r"\[C\d+\]", "", answer))
        faith = 1 + 4 * (sum(t in ctx_toks for t in ans_toks) / len(ans_toks)) if ans_toks and context else None
        return {
            "correctness": correctness,
            "faithfulness": round(faith, 2) if faith is not None else None,
            "citation_accuracy": citation_accuracy(cited, gold_hit_ids),
            "abstention_correct": (ab == exp_ab) if (exp_ab or ab) else None,
            "rationale": "heuristic",
        }
