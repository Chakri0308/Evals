"""RAG Lab API: application factory.

    uvicorn app.main:app                      # dev (with --reload) or prod
    RAG_LAB_FRONTEND_DIST=... uvicorn ...     # prod: also serves the built UI on the same port

Layout: ``app.api`` (HTTP routers) → ``app.core`` (pipeline, registry, settings, storage, vector stores) →
``app.components`` (one file per pluggable component) · ``app.qgen`` (question sets) · ``app.evaluation``.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import config
from app.core import settings
from app.core.registry import discover


def _mount_frontend(app: FastAPI) -> None:
    """Serve the built UI (``npm run build`` → frontend/dist) with SPA fallback, if it exists."""
    dist = config.FRONTEND_DIST
    index = dist / "index.html"
    if not index.exists():
        return
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "Not Found")  # unknown API routes must not fall back to the UI
        f = (dist / path).resolve()
        if path and f.is_file() and dist.resolve() in f.parents:
            return FileResponse(f)
        return FileResponse(index)


def create_app() -> FastAPI:
    config.setup_logging()
    settings.apply_process_env()
    discover()

    from app import startup
    from app.api import router

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        startup.run()
        yield

    app = FastAPI(title="RAG Lab", version="1.0.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])
    app.include_router(router)
    _mount_frontend(app)
    return app


app = create_app()
