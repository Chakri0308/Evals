"""Small JSON-file stores (history, presets, question sets, eval runs, annotations, prompt versions) under DATA_DIR.

One implementation for listing (newest first), reading, writing and deleting, with ids sanitised so a
request can never escape its folder.
"""
from __future__ import annotations

import json
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any, Optional

from .cache import DATA_DIR

_SAFE = re.compile(r"[^A-Za-z0-9 _.-]")


def safe_name(name: str, fallback: str = "item") -> str:
    """Filesystem-safe id: letters, digits, space, _ . - only; no path separators or '..'."""
    s = re.sub(r"\.{2,}", ".", _SAFE.sub("", name or "")).strip(" .")
    return s or fallback


class JsonStore:
    def __init__(self, folder: str):
        self.dir = DATA_DIR / folder
        self.dir.mkdir(parents=True, exist_ok=True)

    def path(self, key: str) -> Path:
        return self.dir / f"{safe_name(key)}.json"

    def get(self, key: str) -> Optional[dict]:
        p = self.path(key)
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None

    def put(self, key: str, value: Any) -> str:
        p = self.path(key)
        p.write_text(json.dumps(value, default=str), encoding="utf-8")
        return p.stem

    def delete(self, key: str) -> bool:
        p = self.path(key)
        if p.exists():
            p.unlink()
            return True
        return False

    def clear(self) -> None:
        for p in self.dir.glob("*.json"):
            p.unlink()

    def list(self, limit: Optional[int] = None, newest_first: bool = True,
             where: Optional[Callable[[dict], bool]] = None) -> list[dict]:
        files = sorted(self.dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=newest_first)
        out = []
        for p in files:
            try:
                rec = json.loads(p.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue  # half-written or corrupt file: skip, don't break the listing
            if where is None or where(rec):
                out.append(rec)
                if limit and len(out) >= limit:
                    break
        return out


history = JsonStore("history")
presets = JsonStore("presets")
qsets = JsonStore("qsets")
evals = JsonStore("evals")
annotations = JsonStore("annotations")
prompts = JsonStore("prompts")
