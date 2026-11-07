"""Pipeline orchestrator: runs the stages in order, traces each one, and passes through disabled stages."""
from __future__ import annotations

import asyncio
import re
import time
from collections.abc import Awaitable, Callable
from typing import Any, Optional

from pydantic import BaseModel, Field

from .documents import get_chunkset
from .interfaces import Ctx
from .readiness import NotReady
from .registry import create, validate_params
from .settings import Unavailable
from .types import ChunkSet, Document, Hit, QueryBundle

STAGES = ["query_transform", "chunking", "retrieval", "fusion", "rerank", "context_filter", "prompt", "generation"]


class StageConfig(BaseModel):
    enabled: bool = True
    component: str
    params: dict[str, Any] = Field(default_factory=dict)


class PipelineConfig(BaseModel):
    id: str = "A"
    name: str = "Pipeline"
    color: str = "indigo"
    tokenizer: str = "tiktoken"
    stages: dict[str, StageConfig]


Emit = Callable[[str, dict], Awaitable[None]]

CITE = re.compile(r"\[([^\]]*C\d+[^\]]*)\]")


def extract_citations(answer: str) -> list[str]:
    out: list[str] = []
    for grp in CITE.findall(answer or ""):
        for cid in re.findall(r"C\d+", grp):
            if cid not in out:
                out.append(cid)
    return out


def _hits_payload(hits: list[Hit]) -> list[dict]:
    return [h.model_dump() for h in hits]


async def run_pipeline(doc: Document, cfg: PipelineConfig, question: str, emit: Optional[Emit] = None,
                       stream_tokens: bool = True) -> dict:
    async def send(ev: str, data: dict):
        if emit:
            await emit(ev, data)

    st = cfg.stages
    timings: dict[str, float] = {}
    traces: dict[str, Any] = {}
    status: dict[str, str] = {}
    result: dict[str, Any] = {"pane": cfg.id, "question": question}
    notices: list[dict] = []  # fallbacks taken (shown as small notes in the UI)

    def gen_llm():
        g = st["generation"]
        return create("llm", g.component, g.params)

    ctx_trace: dict[str, Any] = {}
    ctx = Ctx(doc=doc, tokenizer=create("tokenizer", cfg.tokenizer), llm_factory=gen_llm)

    async def stage(name: str, fn, skip_reason: Optional[str] = None, passthrough: Optional[str] = None):
        """Run one stage with timing/trace. fn returns (value, trace, count_in, count_out)."""
        sc = st.get(name)
        comp = sc.component if sc else None
        await send("stage_start", {"stage": name, "component": comp})
        t0 = time.perf_counter()
        ctx.trace = {}
        if skip_reason:
            status[name] = "skipped"
            traces[name] = {"skipped": skip_reason}
            await send("stage_end", {"stage": name, "status": "skipped", "reason": skip_reason, "ms": 0,
                                     "component": comp})
            return None
        try:
            value, trace, cin, cout = await fn()
        except NotReady as e:
            ms = round((time.perf_counter() - t0) * 1000, 1)
            status[name] = "not_ready"
            traces[name] = {"readiness": e.report}
            await send("stage_end", {"stage": name, "status": "not_ready", "ms": ms, "component": comp,
                                     "reason": e.report["headline"], "trace": {"readiness": e.report}})
            raise PaneNotReady(name, e.report) from e
        except Unavailable as e:
            # capability missing (policy / key / model): fall back instead of failing
            ms = round((time.perf_counter() - t0) * 1000, 1)
            status[name] = "skipped"
            reason = f"fallback: {e.reason}"
            traces[name] = {"skipped": reason, "fallback": True, **ctx.trace}
            notices.append({"stage": name, "message": e.reason})
            await send("stage_end", {"stage": name, "status": "skipped", "reason": reason, "ms": ms,
                                     "component": comp, "trace": traces[name]})
            return None
        except Exception as e:  # noqa: BLE001
            ms = round((time.perf_counter() - t0) * 1000, 1)
            status[name] = "error"
            msg = f"{type(e).__name__}: {e}"
            await send("stage_end", {"stage": name, "status": "error", "ms": ms, "error": msg, "component": comp})
            raise StageError(name, msg) from e
        ms = round((time.perf_counter() - t0) * 1000, 1)
        timings[name] = ms
        trace = {**(trace or {}), **ctx.trace}
        traces[name] = trace
        status[name] = "skipped" if passthrough else "ok"
        if passthrough:
            trace["skipped"] = passthrough
        await send("stage_end", {"stage": name, "status": status[name], "ms": ms, "count_in": cin, "count_out": cout,
                                 "component": comp, "trace": trace, **({"reason": passthrough} if passthrough else {})})
        return value

    def disabled(name):
        sc = st.get(name)
        return sc is None or not sc.enabled

    try:
        # 1. query transform -------------------------------------------------------------
        async def do_qt():
            qt = create("query_transform", st["query_transform"].component, st["query_transform"].params)
            qb = await qt.transform(question, ctx)
            return qb, {"bundle": qb.model_dump()}, 1, len(set(qb.queries) | set(qb.dense_queries))

        qb = await stage("query_transform", do_qt, "disabled: original question used" if disabled("query_transform") else None)
        if qb is None:
            qb = QueryBundle(original=question, queries=[question], dense_queries=[question])
        result["query_bundle"] = qb.model_dump()

        # 2. chunking ----------------------------------------------------------------------
        async def do_chunk():
            sc = st["chunking"]
            cs, hit = await asyncio.to_thread(get_chunkset, doc, sc.component, sc.params, sc.enabled, cfg.tokenizer)
            toks = [c.tokens for c in cs.chunks]
            return cs, {"chunkset_key": cs.key, "cache_hit": hit, "chunks": len(cs.chunks),
                        "avg_tokens": round(sum(toks) / max(1, len(toks)), 1),
                        "max_tokens": max(toks or [0]), "whole_document": not sc.enabled}, 1, len(cs.chunks)

        cs: ChunkSet = await stage("chunking", do_chunk, None,
                                   "disabled: whole document is one chunk" if disabled("chunking") else None)
        if cs is None:  # chunker unavailable (e.g. semantic chunker without embeddings) -> heading-aware
            cs, _ = await asyncio.to_thread(get_chunkset, doc, "heading_aware", {}, True, cfg.tokenizer)
            traces["chunking"]["fallback_chunker"] = "heading_aware"
        result["chunkset_key"] = cs.key
        result["num_chunks"] = len(cs.chunks)

        closed_book = disabled("retrieval")

        # 3. retrieval ---------------------------------------------------------------------
        async def do_ret():
            r = create("retriever", st["retrieval"].component, st["retrieval"].params)
            out = await r.retrieve(qb, cs, ctx)
            return out, {"lists": {k: _hits_payload(v) for k, v in out.lists.items()},
                         "queries": qb.queries, "dense_queries": qb.dense_queries}, len(cs.chunks), \
                sum(len(v) for v in out.lists.values())

        rout = await stage("retrieval", do_ret, "disabled: closed-book (no context)" if closed_book else None)

        # 4. fusion ------------------------------------------------------------------------
        top_k = 5
        if not closed_book:
            top_k = int(validate_params("retriever", st["retrieval"].component, st["retrieval"].params)
                        .model_dump().get("top_k", 5))
        dropped: list[Hit] = []

        def fusion_skip():
            if closed_book:
                return "no retrieval"
            if len(rout.lists) < 2:
                return "single retriever: nothing to fuse"
            return None

        async def do_fuse():
            if disabled("fusion"):
                hits = _interleave(rout.lists)
                note = "disabled: lists interleaved round-robin"
            else:
                f = create("fuser", st["fusion"].component, st["fusion"].params)
                hits = f.fuse(rout)
                note = None
            return hits, {"fused": _hits_payload(hits), **({"note": note} if note else {})}, \
                sum(len(v) for v in rout.lists.values()), len(hits)

        hits: list[Hit] = []
        if not closed_book:
            fskip = fusion_skip()
            fused = await stage("fusion", do_fuse, fskip)
            if fused is None:
                fused = list(rout.lists.values())[0] if rout.lists else []
            for i, h in enumerate(fused):
                h.ranks["retrieval"] = i + 1
            hits = fused[:top_k]
            for h in fused[top_k:]:
                h.dropped_by, h.drop_reason = "retrieval", f"rank #{h.ranks['retrieval']} > top_k {top_k}"
            dropped.extend(fused[top_k:])
        else:
            await stage("fusion", None, "no retrieval")

        # 5. rerank -------------------------------------------------------------------------
        async def do_rerank():
            rr = create("reranker", st["rerank"].component, st["rerank"].params)
            n_in = len(hits)
            kept, drop = await rr.rerank(question, hits, cs, ctx)
            return (kept, drop), {"ranked": _hits_payload(kept + drop)}, n_in, len(kept)

        rskip = "no retrieval" if closed_book else ("disabled: order unchanged" if disabled("rerank") else None)
        rr = await stage("rerank", do_rerank, rskip)
        if rr:
            hits, d = rr
            dropped.extend(d)

        # 6. context filter -------------------------------------------------------------------
        async def do_filter():
            cf = create("context_filter", st["context_filter"].component, st["context_filter"].params)
            n_in = len(hits)
            kept, drop = cf.filter(hits, cs, ctx)
            return (kept, drop), {"kept": [h.chunk_id for h in kept],
                                  "dropped": [{"id": h.chunk_id, "reason": h.drop_reason} for h in drop]}, n_in, len(kept)

        fskip = "no retrieval" if closed_book else ("disabled: all chunks kept" if disabled("context_filter") else None)
        fr = await stage("context_filter", do_filter, fskip)
        if fr:
            hits, d = fr
            dropped.extend(d)

        by = cs.by_id()
        ctx_chunks = [by[h.chunk_id] for h in hits]

        # 7. prompt ---------------------------------------------------------------------------
        async def do_prompt():
            if disabled("prompt"):
                ctx_txt = "\n\n".join(f"[{c.id}]\n{c.text}" for c in ctx_chunks)
                pr = {"system": "", "user": (ctx_txt + "\n\n" if ctx_txt else "") + question, "closed_book": closed_book}
            else:
                pb = create("prompt", st["prompt"].component, st["prompt"].params)
                pr = pb.build(question, ctx_chunks, closed_book)
            tok = ctx.tokenizer
            pr["tokens"] = tok.count(pr["system"]) + tok.count(pr["user"])
            return pr, pr, len(ctx_chunks), pr["tokens"]

        prompt = await stage("prompt", do_prompt, None, "disabled: bare context + question" if disabled("prompt") else None)
        result["prompt"] = prompt

        # 8. generation -----------------------------------------------------------------------
        answer = ""
        usage = {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}

        async def do_gen():
            nonlocal answer
            llm = gen_llm()
            fallback = None
            ok, why = llm.ready()
            if not ok:
                fallback = why

            async def produce(model):
                nonlocal answer
                model.context_chunks = ctx_chunks
                if getattr(model.p, "streaming", True) and stream_tokens:
                    async for t in model.stream(prompt["system"], prompt["user"]):
                        answer += t
                        await send("token", {"text": t})
                else:
                    answer = await model.complete(prompt["system"], prompt["user"])
                    await send("token", {"text": answer})

            if fallback is None:
                try:
                    await produce(llm)
                except Exception as e:  # noqa: BLE001
                    if answer:  # failed mid-stream: keep it an error, a partial answer would mislead
                        raise
                    fallback = f"{type(e).__name__}: {str(e)[:240]}"
            if fallback is not None:
                # autonomous fallback: answer from the retrieved chunks without any model (quotes + citations)
                notices.append({"stage": "generation", "message": f"{llm.component_name} unavailable ({fallback}); "
                                                                  "answered extractively from the retrieved chunks"})
                result["answer_source"] = {"kind": "extractive_fallback", "wanted": llm.component_name,
                                           "reason": fallback}
                llm = create("llm", "extractive", {})
                await produce(llm)
            u = llm.usage.model_dump()
            if not u["input_tokens"]:
                u["input_tokens"] = prompt["tokens"]
                u["output_tokens"] = ctx.tokenizer.count(answer)
            usage.update(u)
            return answer, {"model": llm.model_name, "provider": llm.component_name, "usage": u,
                            **({"fallback": result["answer_source"]} if fallback is not None else {})}, \
                prompt["tokens"], u["output_tokens"]

        await stage("generation", do_gen, "disabled: retrieval-only run" if disabled("generation") else None)
    except PaneNotReady as e:
        result.update({"not_ready": e.report, "answer": ""})
        for name in STAGES[STAGES.index(e.stage) + 1:]:
            sc = st.get(name)
            status[name] = "skipped"
            await send("stage_end", {"stage": name, "status": "skipped", "ms": 0,
                                     "component": sc.component if sc else None,
                                     "reason": "waiting for " + " and ".join(e.report["missing"])})
        _finish(result, locals(), timings, traces, status, cs if "cs" in locals() else None)
        result["notices"] = notices
        await send("done", result)
        return result
    except StageError as e:
        result.update({"error": {"stage": e.stage, "message": e.message}})
        result.setdefault("answer", "")
        _finish(result, locals(), timings, traces, status, cs if "cs" in locals() else None)
        result["notices"] = notices
        await send("error", {"stage": e.stage, "message": e.message})
        await send("done", result)
        return result

    result["answer"] = answer
    result["usage"] = usage
    result["notices"] = notices
    _finish(result, locals(), timings, traces, status, cs)
    await send("done", result)
    return result


def _finish(result, loc, timings, traces, status, cs):
    hits = loc.get("hits") or []
    dropped = loc.get("dropped") or []
    result["timings"] = timings
    result["total_ms"] = round(sum(timings.values()), 1)
    result["traces"] = traces
    result["status"] = status
    result["cited"] = extract_citations(result.get("answer", ""))
    for i, h in enumerate(hits):
        h.ranks["final"] = i + 1
    result["hits"] = _hits_payload(hits)
    seen = {h.chunk_id for h in hits}
    uniq_dropped = []
    for h in dropped:
        if h.chunk_id not in seen:
            seen.add(h.chunk_id)
            uniq_dropped.append(h)
    result["dropped"] = _hits_payload(uniq_dropped[:40])
    if cs is not None:
        by = cs.by_id()
        ids = [h["chunk_id"] for h in result["hits"]] + [h["chunk_id"] for h in result["dropped"]]
        result["chunks"] = {cid: by[cid].model_dump() for cid in ids if cid in by}
    else:
        result["chunks"] = {}
    result.setdefault("usage", {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0})


def _interleave(lists: dict[str, list[Hit]]) -> list[Hit]:
    out, seen = [], set()
    ls = list(lists.values())
    for i in range(max((len(x) for x in ls), default=0)):
        for x in ls:
            if i < len(x) and x[i].chunk_id not in seen:
                seen.add(x[i].chunk_id)
                out.append(x[i])
    return out


class PaneNotReady(Exception):
    def __init__(self, stage: str, report: dict):
        super().__init__(report.get("headline", "not ready"))
        self.stage, self.report = stage, report


class StageError(Exception):
    def __init__(self, stage: str, message: str):
        super().__init__(f"{stage}: {message}")
        self.stage = stage
        self.message = message
