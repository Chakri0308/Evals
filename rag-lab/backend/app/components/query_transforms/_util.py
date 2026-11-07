import re

from app.core.settings import Unavailable


def parse_lines(text: str, n: int) -> list[str]:
    out = []
    for ln in text.splitlines():
        ln = re.sub(r"^\s*(?:[-*•]|\d+[.)]|Q\d*[:.)]|Sub-question \d+:)\s*", "", ln).strip().strip('"')
        if len(ln) > 3:
            out.append(ln)
    return out[:n]


async def llm_call(ctx, system: str, user: str) -> str:
    llm = ctx.llm_factory()
    ok, why = llm.ready()
    if not ok:
        raise Unavailable(f"query rewrite skipped: {why}", what="llm")
    text = await llm.complete(system, user)
    ctx.trace.setdefault("llm_usage", []).append(llm.usage.model_dump())
    return text.strip()
