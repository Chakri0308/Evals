"""Vector stores agree with each other and persist (Chroma, FAISS, in-memory, pgvector, Pinecone)."""
import asyncio

import pytest

from app.core.registry import create

from .helpers import chunkset as _cs


# ------------------------------------------------------------- vector database (Chroma)
def test_vector_stores_agree_and_persist(doc, tok):
    """Chroma, FAISS and in-memory return the same ranking; collections are reused, not rebuilt."""
    from app.components.retrievers._common import dense_search
    from app.components.vector_stores.chroma_store import client
    from app.core import vectorstore
    from app.core.embeddings import resolve as resolve_embedder

    cs = _cs(doc, tok)
    q = ["Is it fine to write won't or can't?"]
    runs = {st: asyncio.run(dense_search(q, cs, 8, "local:BAAI/bge-small-en-v1.5", 0.0, st))
            for st in ("in_memory", "chroma", "faiss")}
    ref = [h.chunk_id for h in runs["in_memory"][0]]
    for st, (hits, info) in runs.items():
        assert info["vector_store"] == st and info["vectors"] == len(cs.chunks)
        assert [h.chunk_id for h in hits] == ref, st
        for a, b in zip(hits, runs["in_memory"][0]):
            assert abs(a.scores["dense"] - b.scores["dense"]) < 1e-3

    name, params = resolve_embedder("local:BAAI/bge-small-en-v1.5")
    emb = create("embedder", name, params)
    vectorstore._ready.clear()
    for st in ("chroma", "faiss"):
        col, existed = vectorstore.ensure(st, cs, emb, lambda: (_ for _ in ()).throw(AssertionError("rebuilt")))
        assert existed
    got = client().get_collection(col).get(ids=[cs.chunks[0].id], include=["documents", "metadatas"])
    assert got["documents"][0] == cs.chunks[0].index_text
    assert got["metadatas"][0]["start"] == cs.chunks[0].start
    assert any(c["name"] == col for row in vectorstore.stats() if row["store"] == "chroma" for c in row["collections"])


def test_pgvector_matches_in_memory(doc, tok):
    """Runs against a real Postgres+pgvector when PGVECTOR_TEST_DSN is set (skipped otherwise)."""
    import os

    dsn = os.environ.get("PGVECTOR_TEST_DSN")
    if not dsn:
        pytest.skip("set PGVECTOR_TEST_DSN to test pgvector against a live database")
    from app.components.retrievers._common import dense_search
    from app.core import vectorstore

    os.environ["PGVECTOR_DSN"] = dsn
    vectorstore.forget("pgvector")
    cs = _cs(doc, tok)
    q = ["How often do we ship the changelog?"]
    pg, info = asyncio.run(dense_search(q, cs, 8, "local:BAAI/bge-small-en-v1.5", 0.0, "pgvector"))
    mem, _ = asyncio.run(dense_search(q, cs, 8, "local:BAAI/bge-small-en-v1.5", 0.0, "in_memory"))
    assert [h.chunk_id for h in pg] == [h.chunk_id for h in mem]
    st = vectorstore.store("pgvector")
    assert st.count(info["collection"]) == len(cs.chunks)


class _FakePinecone:
    """Just enough of the Pinecone client to exercise PineconeStore without a network."""

    class _Desc:
        def __init__(self, name, dim):
            self.name, self.dimension, self.metric, self.host = name, dim, "cosine", None

    class _Index:
        def __init__(self):
            self.ns = {}

        def upsert(self, vectors, namespace):
            self.ns.setdefault(namespace, {}).update({v["id"]: v for v in vectors})

        def query(self, vector, top_k, namespace):
            import numpy as np

            q = np.asarray(vector)
            scored = sorted(((float(np.dot(q, v["values"])), i) for i, v in self.ns.get(namespace, {}).items()),
                            reverse=True)[:top_k]
            return {"matches": [{"id": i, "score": s} for s, i in scored]}

        def describe_index_stats(self):
            class S:
                pass
            st = S()
            st.namespaces = {n: {"vector_count": len(v)} for n, v in self.ns.items()}
            return st

        def delete(self, delete_all, namespace):
            self.ns.pop(namespace, None)

    def __init__(self):
        self.indexes, self.idx = {}, self._Index()

    def list_indexes(self):
        return [self._Desc(n, d) for n, d in self.indexes.items()]

    def create_index(self, name, dimension, metric, spec):
        self.indexes[name] = dimension

    def describe_index(self, name):
        return self._Desc(name, self.indexes[name])

    def Index(self, name=None, host=None):  # noqa: N802
        return self.idx


def test_pinecone_store_logic(doc, tok, monkeypatch):
    from app.components.retrievers._common import dense_search
    from app.components.vector_stores import pinecone_store
    from app.core import vectorstore

    fake = _FakePinecone()
    monkeypatch.setenv("PINECONE_API_KEY", "test")
    monkeypatch.setattr(pinecone_store, "client", lambda: fake)
    vectorstore.forget("pinecone")
    ok, why = vectorstore.check("pinecone", fresh=True)
    assert ok and "created on first use" in why
    cs = _cs(doc, tok)
    q = ["Which dictionary do we follow?"]
    pc, info = asyncio.run(dense_search(q, cs, 8, "local:BAAI/bge-small-en-v1.5", 0.0, "pinecone"))
    mem, _ = asyncio.run(dense_search(q, cs, 8, "local:BAAI/bge-small-en-v1.5", 0.0, "in_memory"))
    assert fake.indexes["rag-lab"] == 384  # index auto-created with the embedding dimension
    assert [h.chunk_id for h in pc] == [h.chunk_id for h in mem]
    assert len(fake.idx.ns[info["collection"]]) == len(cs.chunks)
    vectorstore.forget("pinecone")
