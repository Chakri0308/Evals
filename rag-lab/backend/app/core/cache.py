"""Layered disk + memory cache keyed by content hashes."""
from __future__ import annotations

import hashlib
import json
import threading
from collections.abc import Callable
from typing import Any, Optional

import numpy as np

from app.config import DATA_DIR  # noqa: F401  (re-exported: most modules import it from here)


def stable_hash(*parts: Any, n: int = 16) -> str:
    h = hashlib.sha256()
    for p in parts:
        if isinstance(p, (bytes, bytearray)):
            h.update(p)
        else:
            h.update(json.dumps(p, sort_keys=True, default=str).encode())
        h.update(b"|")
    return h.hexdigest()[:n]


class MemoryLRU:
    def __init__(self, maxsize: int = 64):
        self.maxsize = maxsize
        self._d: dict[str, Any] = {}
        self._lock = threading.Lock()

    def get(self, k: str) -> Optional[Any]:
        with self._lock:
            if k in self._d:
                v = self._d.pop(k)
                self._d[k] = v
                return v
        return None

    def set(self, k: str, v: Any) -> None:
        with self._lock:
            self._d.pop(k, None)
            self._d[k] = v
            while len(self._d) > self.maxsize:
                self._d.pop(next(iter(self._d)))


_mem = MemoryLRU(128)
_key_locks: dict[str, threading.Lock] = {}
_key_locks_guard = threading.Lock()


def _lock_for(key: str) -> threading.Lock:
    with _key_locks_guard:
        return _key_locks.setdefault(key, threading.Lock())


def cached_json(layer: str, key: str, compute: Callable[[], Any], dump: Callable[[Any], Any],
                load: Callable[[Any], Any]) -> tuple[Any, bool]:
    """Return (value, hit). Memory first, then disk, else compute and persist."""
    mk = f"{layer}:{key}"
    v = _mem.get(mk)
    if v is not None:
        return v, True
    with _lock_for(mk):
        v = _mem.get(mk)
        if v is not None:
            return v, True
        path = DATA_DIR / layer / f"{key}.json"
        if path.exists():
            v = load(json.loads(path.read_text(encoding="utf-8")))
            _mem.set(mk, v)
            return v, True
        v = compute()
        path.write_text(json.dumps(dump(v)), encoding="utf-8")
        _mem.set(mk, v)
        return v, False


def cached_array(layer: str, key: str, compute: Callable[[], np.ndarray]) -> tuple[np.ndarray, bool]:
    mk = f"{layer}:{key}"
    v = _mem.get(mk)
    if v is not None:
        return v, True
    with _lock_for(mk):
        v = _mem.get(mk)
        if v is not None:
            return v, True
        path = DATA_DIR / layer / f"{key}.npy"
        if path.exists():
            v = np.load(path)
            _mem.set(mk, v)
            return v, True
        v = compute()
        np.save(path, v)
        _mem.set(mk, v)
        return v, False


def cached_memory(layer: str, key: str, compute: Callable[[], Any]) -> tuple[Any, bool]:
    mk = f"{layer}:{key}"
    v = _mem.get(mk)
    if v is not None:
        return v, True
    with _lock_for(mk):
        v = _mem.get(mk)
        if v is not None:
            return v, True
        v = compute()
        _mem.set(mk, v)
        return v, False
