import os
import threading
from pathlib import Path

import numpy as np

from app.core.cache import DATA_DIR
from app.core.registry import register

from ._base import VectorStore, missing_package

_client = None
_lock = threading.Lock()


def _path() -> Path:
    return Path(os.environ.get("CHROMA_PATH") or DATA_DIR / "chroma")


def client():
    """Embedded persistent client by default; a Chroma server if CHROMA_HOST is set."""
    global _client
    with _lock:
        if _client is None:
            import chromadb
            from chromadb.config import Settings

            st = Settings(anonymized_telemetry=False)
            if os.environ.get("CHROMA_HOST"):
                _client = chromadb.HttpClient(host=os.environ["CHROMA_HOST"],
                                              port=int(os.environ.get("CHROMA_PORT", "8000")), settings=st)
            else:
                _path().mkdir(parents=True, exist_ok=True)
                _client = chromadb.PersistentClient(path=str(_path()), settings=st)
        return _client


@register("vector_store", "chroma", label="Chroma", order=1)
class ChromaStore(VectorStore):
    """Chroma vector database (HNSW, cosine). Embedded and persisted to data/chroma by default; set CHROMA_HOST to use a Chroma server."""

    needs = "pip install chromadb (optional: CHROMA_HOST / CHROMA_PORT for a server, CHROMA_PATH for the folder)"

    def location(self):
        return f"server {os.environ['CHROMA_HOST']}" if os.environ.get("CHROMA_HOST") else str(_path())

    def available(self):
        try:
            import chromadb  # noqa: F401
        except ImportError:
            return False, missing_package("chromadb")
        try:
            client().heartbeat()
            return True, f"connected · {self.location()}"
        except Exception as e:  # noqa: BLE001
            return False, f"cannot reach Chroma ({self.location()}): {e}"

    def _get(self, name):
        try:
            return client().get_collection(name)
        except Exception:  # noqa: BLE001
            return None

    def count(self, name):
        col = self._get(name)
        return col.count() if col is not None else 0

    def reset(self, name):
        if self._get(name) is not None:
            client().delete_collection(name)

    def upsert(self, name, ids, vectors, texts, metas):
        col = client().get_or_create_collection(name, metadata={"hnsw:space": "cosine"})
        for i in range(0, len(ids), 512):
            col.upsert(ids=ids[i:i + 512], embeddings=np.asarray(vectors[i:i + 512], dtype=np.float32).tolist(),
                       documents=texts[i:i + 512], metadatas=metas[i:i + 512])

    def query(self, name, vector, k):
        col = client().get_collection(name)
        n = min(k, col.count())
        if n <= 0:
            return []
        res = col.query(query_embeddings=[np.asarray(vector, dtype=np.float32).tolist()], n_results=n,
                        include=["distances"])
        return [(cid, 1.0 - float(d)) for cid, d in zip(res["ids"][0], res["distances"][0])]

    def collections(self):
        return [{"name": c.name, "count": c.count()} for c in client().list_collections() if c.name.startswith("rag_")]
