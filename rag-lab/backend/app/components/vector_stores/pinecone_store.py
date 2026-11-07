import os
import threading

import numpy as np

from app.core.registry import register

from ._base import VectorStore, missing_package

_lock = threading.Lock()
_client = None


def _index_name() -> str:
    return os.environ.get("PINECONE_INDEX", "rag-lab")


def client():
    global _client
    with _lock:
        if _client is None:
            from pinecone import Pinecone

            kw = {"api_key": os.environ["PINECONE_API_KEY"]}
            if os.environ.get("PINECONE_HOST"):  # e.g. Pinecone Local: http://localhost:5080
                kw["host"] = os.environ["PINECONE_HOST"]
            _client = Pinecone(**kw)
        return _client


@register("vector_store", "pinecone", label="Pinecone", order=4)
class PineconeStore(VectorStore):
    """Pinecone serverless index; each collection is a namespace in one index (PINECONE_INDEX, default rag-lab, cosine). The index is created on first use if it does not exist."""

    needs = "pip install pinecone and set PINECONE_API_KEY (optional: PINECONE_INDEX, PINECONE_CLOUD, PINECONE_REGION)"

    def location(self):
        return f"index '{_index_name()}'"

    def available(self):
        if not os.environ.get("PINECONE_API_KEY"):
            return False, "PINECONE_API_KEY is not set in .env"
        try:
            import pinecone  # noqa: F401
        except ImportError:
            return False, missing_package("pinecone")
        try:
            names = [i.name for i in client().list_indexes()]
        except Exception as e:  # noqa: BLE001
            return False, f"cannot reach Pinecone: {str(e)[:200]}"
        if _index_name() in names:
            d = client().describe_index(_index_name())
            return True, f"connected · index '{d.name}' ({d.dimension}d, {d.metric})"
        return True, f"connected · index '{_index_name()}' will be created on first use"

    def _index(self, dim=None):
        pc = client()
        name = _index_name()
        if name not in [i.name for i in pc.list_indexes()]:
            if dim is None:
                return None
            from pinecone import ServerlessSpec

            pc.create_index(name=name, dimension=dim, metric="cosine",
                            spec=ServerlessSpec(cloud=os.environ.get("PINECONE_CLOUD", "aws"),
                                                region=os.environ.get("PINECONE_REGION", "us-east-1")))
        desc = pc.describe_index(name)
        if dim is not None and desc.dimension != dim:
            from app.core.settings import Unavailable

            raise Unavailable(f"Pinecone index '{name}' is {desc.dimension}-d but the embedding model makes {dim}-d "
                              "vectors. Use another PINECONE_INDEX or embedding model.", what="vector_db")
        return pc.Index(name=name, host=desc.host) if getattr(desc, "host", None) else pc.Index(name)

    def count(self, name):
        idx = self._index()
        if idx is None:
            return 0
        ns = idx.describe_index_stats().namespaces or {}
        got = ns.get(name)
        return int(getattr(got, "vector_count", 0) or (got or {}).get("vector_count", 0) if got else 0)

    def reset(self, name):
        idx = self._index()
        if idx is not None:
            try:
                idx.delete(delete_all=True, namespace=name)
            except Exception:  # noqa: BLE001  (namespace does not exist yet)
                pass

    def upsert(self, name, ids, vectors, texts, metas):
        v = np.asarray(vectors, dtype=np.float32)
        idx = self._index(dim=int(v.shape[1]))
        recs = [{"id": i, "values": vec.tolist(), "metadata": {**m, "text": tx[:2000]}}
                for i, vec, tx, m in zip(ids, v, texts, metas)]
        for i in range(0, len(recs), 100):
            idx.upsert(vectors=recs[i:i + 100], namespace=name)

    def query(self, name, vector, k):
        res = self._index().query(vector=np.asarray(vector, dtype=np.float32).tolist(), top_k=k, namespace=name)
        matches = res.matches if hasattr(res, "matches") else res["matches"]
        return [(m.id if hasattr(m, "id") else m["id"], float(m.score if hasattr(m, "score") else m["score"]))
                for m in matches]

    def collections(self):
        idx = self._index()
        if idx is None:
            return []
        ns = idx.describe_index_stats().namespaces or {}
        return [{"name": n, "count": int(getattr(v, "vector_count", 0) or 0)} for n, v in ns.items() if n.startswith("rag_")]
