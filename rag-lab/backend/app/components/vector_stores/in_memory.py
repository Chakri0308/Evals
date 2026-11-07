import threading

import numpy as np

from app.core.registry import register

from ._base import VectorStore

_data: dict[str, tuple[list[str], np.ndarray]] = {}
_lock = threading.Lock()


@register("vector_store", "in_memory", label="In-memory (NumPy, exact)", order=0)
class InMemoryStore(VectorStore):
    """Exact brute-force cosine search over a NumPy matrix in this process. Nothing to install or configure; rebuilt after a restart (from the embedding cache)."""

    def location(self):
        return "process memory"

    def available(self):
        return True, "always available"

    def count(self, name):
        ids, _ = _data.get(name, ([], None))
        return len(ids)

    def reset(self, name):
        with _lock:
            _data.pop(name, None)

    def upsert(self, name, ids, vectors, texts, metas):
        with _lock:
            old_ids, old = _data.get(name, ([], np.zeros((0, vectors.shape[1]), np.float32)))
            _data[name] = (old_ids + list(ids), np.vstack([old, vectors.astype(np.float32)]))

    def query(self, name, vector, k):
        ids, mat = _data[name]
        sims = mat @ np.asarray(vector, dtype=np.float32)
        order = np.argsort(-sims)[:k]
        return [(ids[i], float(sims[i])) for i in order]

    def collections(self):
        return [{"name": n, "count": len(ids)} for n, (ids, _) in _data.items()]
