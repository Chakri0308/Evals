"""Shared fixtures. Tests write caches and vector DBs to a throwaway folder, never the app's data/ directory."""
import os
import tempfile

os.environ.setdefault("RAG_LAB_DATA", tempfile.mkdtemp(prefix="rag_lab_test_"))
os.environ.setdefault("RAG_LAB_WARMUP", "false")  # no background model loading during tests

from pathlib import Path  # noqa: E402

import pytest  # noqa: E402

from app.core.registry import create, discover  # noqa: E402

discover()
SAMPLE = Path(__file__).resolve().parents[2] / "samples" / "style_guide_sample.md"


@pytest.fixture(scope="session")
def doc():
    return create("parser", "markdown").parse(SAMPLE.read_bytes(), "s.md", "test")


@pytest.fixture(scope="session")
def tok():
    return create("tokenizer", "tiktoken")
