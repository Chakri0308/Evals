import json
import os
import threading
from pathlib import Path

import numpy as np

from app.core.cache import DATA_DIR
from app.core.registry import register

from ._base import VectorStore, missing_package

_cache: dict[str, tuple[object, list[str]]] = {}
_lock = threading.Lock()


def _dir() -> Path:
    d = Path(os.environ.get("FAISS_PATH") or DATA_DIR / "faiss")
    d.mkdir(parents=True, exist_ok=True)
    return d


@register("vector_store", "faiss", label="FAISS", order=2)
class FaissStore(VectorStore):
    """Facebook AI Similarity Search: a local index file per collection in data/faiss. FAISS_INDEX=flat (exact, default) or hnsw (approximate, for large corpora)."""

    needs = "pip install faiss-cpu (optional: FAISS_INDEX=flat|hnsw, FAISS_PATH)"

    def location(self):
        return str(_dir())

    def available(self):
        try:
            import faiss
        except ImportError:
            return False, missing_package("faiss", "faiss-cpu")
        return True, f"faiss {faiss.__version__} · {os.environ.get('FAISS_INDEX', 'flat')} · {self.location()}"

    def _files(self, name):
        return _dir() / f"{name}.faiss", _dir() / f"{name}.ids.json"

    def _load(self, name):
        import faiss

        with _lock:
            if name in _cache:
                return _cache[name]
            fi, fid = self._files(name)
            if not fi.exists() or not fid.exists():
                return None
            _cache[name] = (faiss.read_index(str(fi)), json.loads(fid.read_text()))
            return _cache[name]

    def count(self, name):
        got = self._load(name)
        return got[0].ntotal if got else 0

    def reset(self, name):
        with _lock:
            _cache.pop(name, None)
            for f in self._files(name):
                f.unlink(missing_ok=True)

    def upsert(self, name, ids, vectors, texts, metas):
        import faiss

        v = np.ascontiguousarray(vectors, dtype=np.float32)
        got = self._load(name)
        if got:
            index, all_ids = got
        else:
            d = v.shape[1]
            if os.environ.get("FAISS_INDEX", "flat").lower() == "hnsw":
                index = faiss.IndexHNSWFlat(d, 32, faiss.METRIC_INNER_PRODUCT)
            else:
                index = faiss.IndexFlatIP(d)  # inner product on normalised vectors = cosine
            all_ids = []
        index.add(v)
        all_ids = all_ids + list(ids)
        fi, fid = self._files(name)
        with _lock:
            faiss.write_index(index, str(fi))
            fid.write_text(json.dumps(all_ids))
            _cache[name] = (index, all_ids)

    def query(self, name, vector, k):
        index, ids = self._load(name)
        k = min(k, index.ntotal)
        if k <= 0:
            return []
        scores, idx = index.search(np.asarray(vector, dtype=np.float32)[None, :], k)
        return [(ids[i], float(s)) for s, i in zip(scores[0], idx[0]) if i >= 0]

    def collections(self):
        out = []
        for f in sorted(_dir().glob("rag_*.faiss")):
            out.append({"name": f.stem, "count": self.count(f.stem)})
        return out
