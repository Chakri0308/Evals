"""Process-level configuration: paths, .env loading, logging, CORS, production frontend.

Everything that varies between machines comes from environment variables (see ``.env.example``). Runtime choices
the user can change from the UI (default LLM, vector store, access policy) live in ``app.core.settings``.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]  # rag-lab/
load_dotenv(ROOT / ".env")

DATA_DIR = Path(os.environ.get("RAG_LAB_DATA") or ROOT / "data")
DATA_SUBDIRS = ("docs", "uploads", "chunks", "emb", "presets", "history", "qsets", "evals")
SAMPLE_DOC = ROOT / "samples" / "style_guide_sample.md"
FRONTEND_DIST = Path(os.environ.get("RAG_LAB_FRONTEND_DIST") or ROOT / "frontend" / "dist")

# Comma-separated origins for the API. In production the UI is served by the API itself (same origin),
# so CORS only matters for the Vite dev server.
CORS_ORIGINS = [o.strip() for o in os.environ.get(
    "RAG_LAB_CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173").split(",") if o.strip()]

LOG_LEVEL = os.environ.get("RAG_LAB_LOG_LEVEL", "INFO").upper()
WARMUP = os.environ.get("RAG_LAB_WARMUP", "true").strip().lower() not in ("0", "false", "no", "off")


def ensure_data_dirs() -> None:
    for sub in DATA_SUBDIRS:
        (DATA_DIR / sub).mkdir(parents=True, exist_ok=True)


def setup_logging() -> None:
    logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
                        datefmt="%H:%M:%S")


ensure_data_dirs()
