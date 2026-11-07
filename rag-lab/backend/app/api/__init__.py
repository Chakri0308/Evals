"""HTTP API: one router per area, mounted under /api by ``app.main.create_app``."""
from fastapi import APIRouter

from . import documents, evals, meta, questions, runs

router = APIRouter(prefix="/api")
for _r in (meta.router, documents.router, runs.router, questions.router, questions.qsets_router, evals.router):
    router.include_router(_r)
