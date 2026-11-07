"""Shared helpers for the routers: document lookup and Server-Sent-Event streaming."""
from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from app.core.documents import load_doc
from app.core.types import Document

log = logging.getLogger("rag_lab.api")
Put = Callable[[str, Any], Awaitable[None]]
KEEPALIVE_S = 15


def doc_or_404(doc_id: str) -> Document:
    d = load_doc(doc_id)
    if not d:
        raise HTTPException(404, f"document {doc_id} not found")
    return d


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


def stream_queue(producer: Callable[[Put], Awaitable[None]]) -> StreamingResponse:
    """Run ``producer(put)`` in the background and stream every ``put(event, data)`` as SSE.

    Sends keep-alive comments while idle, reports an unhandled error as a ``fatal`` event, and cancels the
    producer if the client disconnects.
    """
    q: asyncio.Queue = asyncio.Queue()

    async def put(ev: str, data: Any) -> None:
        await q.put((ev, data))

    async def gen():
        task = asyncio.create_task(producer(put))
        try:
            while True:
                if task.done() and q.empty():
                    if task.exception():
                        log.error("stream failed", exc_info=task.exception())
                        yield _sse("fatal", {"message": str(task.exception())})
                    break
                try:
                    ev, data = await asyncio.wait_for(q.get(), timeout=KEEPALIVE_S)
                except TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                yield _sse(ev, data)
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def stream_job(job: Callable[[Callable[[dict], Awaitable[None]]], Awaitable[Any]]) -> StreamingResponse:
    """Stream a long job: ``progress`` events while it runs, then one ``result`` event with its return value."""
    async def producer(put: Put) -> None:
        async def progress(p: dict) -> None:
            await put("progress", p)

        await put("result", await job(progress))

    return stream_queue(producer)
