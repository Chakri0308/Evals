import json
import re

from pydantic import BaseModel, Field

from app.core.registry import Component, register

from .heuristic import RUBRIC, HeuristicJudge, abstained, citation_accuracy, expects_abstention


@register("judge", "llm", label="LLM judge", order=1)
class LLMJudge(Component):
    """An LLM grades correctness and faithfulness against the rubric. Citation accuracy is computed exactly from the gold chunks."""

    rubric = RUBRIC

    class Params(BaseModel):
        provider: str = Field("default", description="Judge LLM provider, or 'default' to use Settings",
                              json_schema_extra={"x-options": "llm_providers"})
        model: str = Field("", description="Judge model ('' = provider default)", json_schema_extra={"x-suggest": "ollama_models"})

    async def judge(self, item, answer, context, cited, gold_hit_ids):
        from app.core.providers import make_llm

        llm = make_llm(self.p.provider, self.p.model, temperature=0.0, max_tokens=300)
        ok, why = llm.ready()
        if not ok:
            r = await HeuristicJudge(None).judge(item, answer, context, cited, gold_hit_ids)
            r["rationale"] = f"LLM judge unavailable ({why}); used the heuristic judge"
            return r
        ctx = "\n\n".join(f"[{c.id}] {c.text[:800]}" for c in context)[:6000] or "(none)"
        prompt = (f"Rubric:\n{RUBRIC}\n\nQuestion: {item['question']}\nCategory: {item.get('category')}\n"
                  f"Expected answer: {item.get('expected_answer', '')}\n\nRetrieved context:\n{ctx}\n\n"
                  f"System answer:\n{answer}\n\n"
                  'Return JSON: {"correctness": 1-5, "faithfulness": 1-5, "abstained": true/false, "rationale": "..."}')
        try:
            out = await llm.complete("You are a strict, fair evaluator of RAG answers. Output JSON only.", prompt,
                                     json_mode=True)
            m = re.search(r"\{.*\}", out, re.S)
            d = json.loads(m.group() if m else out)
            corr = float(d.get("correctness", 1))
            faith = float(d.get("faithfulness", 1)) if context else None
            ab = bool(d.get("abstained", abstained(answer)))
        except Exception as e:  # noqa: BLE001
            r = await HeuristicJudge(None).judge(item, answer, context, cited, gold_hit_ids)
            r["rationale"] = f"judge parse failed ({e}); used the heuristic judge"
            return r
        exp_ab = expects_abstention(item)
        return {
            "correctness": max(1.0, min(5.0, corr)),
            "faithfulness": max(1.0, min(5.0, faith)) if faith is not None else None,
            "citation_accuracy": citation_accuracy(cited, gold_hit_ids),
            "abstention_correct": (ab == exp_ab) if (exp_ab or ab) else None,
            "rationale": str(d.get("rationale", ""))[:400],
        }
