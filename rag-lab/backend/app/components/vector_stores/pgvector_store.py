import json
import os
import re

import numpy as np

from app.core.registry import register

from ._base import VectorStore, missing_package


def _dsn() -> str:
    return os.environ.get("PGVECTOR_DSN") or os.environ.get("DATABASE_URL") or ""


def _lit(v) -> str:
    return "[" + ",".join(f"{x:.7g}" for x in np.asarray(v, dtype=np.float32).tolist()) + "]"


def _table(name: str) -> str:
    t = "rag_lab_" + re.sub(r"[^a-z0-9_]", "", name.lower())
    return t[:63]


@register("vector_store", "pgvector", label="Postgres + pgvector", order=3)
class PgVectorStore(VectorStore):
    """PostgreSQL with the pgvector extension: one table per collection, cosine distance, HNSW index. Set PGVECTOR_DSN (e.g. postgresql://user:pass@host:5432/db)."""

    needs = "pip install 'psycopg[binary]' and set PGVECTOR_DSN=postgresql://user:pass@host:5432/db (pgvector extension installed)"

    def _connect(self):
        import psycopg

        return psycopg.connect(_dsn(), connect_timeout=4, autocommit=True)

    def location(self):
        d = _dsn()
        return re.sub(r"//([^:@/]+):[^@/]*@", r"//\1:***@", d) if d else "(PGVECTOR_DSN not set)"

    def available(self):
        if not _dsn():
            return False, "PGVECTOR_DSN is not set in .env (postgresql://user:pass@host:5432/db)"
        try:
            import psycopg  # noqa: F401
        except ImportError:
            return False, missing_package("psycopg", "'psycopg[binary]'")
        try:
            with self._connect() as c:
                try:
                    c.execute("CREATE EXTENSION IF NOT EXISTS vector")
                except Exception:  # noqa: BLE001  (no privilege: fine if it already exists)
                    pass
                row = c.execute("SELECT extversion FROM pg_extension WHERE extname = 'vector'").fetchone()
            if not row:
                return False, "connected, but the pgvector extension is not installed in this database"
            return True, f"connected · pgvector {row[0]} · {self.location()}"
        except Exception as e:  # noqa: BLE001
            return False, f"cannot connect to Postgres ({self.location()}): {str(e).strip()[:200]}"

    def count(self, name):
        t = _table(name)
        with self._connect() as c:
            if c.execute("SELECT to_regclass(%s)", (t,)).fetchone()[0] is None:
                return 0
            return c.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0]

    def reset(self, name):
        with self._connect() as c:
            c.execute(f'DROP TABLE IF EXISTS "{_table(name)}"')

    def upsert(self, name, ids, vectors, texts, metas):
        t, d = _table(name), int(np.asarray(vectors).shape[1])
        with self._connect() as c:
            c.execute(f'CREATE TABLE IF NOT EXISTS "{t}" (chunk_id text PRIMARY KEY, embedding vector({d}), '
                      'content text, metadata jsonb)')
            with c.cursor() as cur:
                cur.executemany(
                    f'INSERT INTO "{t}" (chunk_id, embedding, content, metadata) VALUES (%s, %s::vector, %s, %s::jsonb) '
                    'ON CONFLICT (chunk_id) DO UPDATE SET embedding = EXCLUDED.embedding, content = EXCLUDED.content, '
                    'metadata = EXCLUDED.metadata',
                    [(i, _lit(v), tx, json.dumps(m)) for i, v, tx, m in zip(ids, vectors, texts, metas)])
            try:
                c.execute(f'CREATE INDEX IF NOT EXISTS "{t[:55]}_hnsw" ON "{t}" USING hnsw (embedding vector_cosine_ops)')
            except Exception:  # noqa: BLE001  (old pgvector without HNSW: exact scan still works)
                pass

    def query(self, name, vector, k):
        t, q = _table(name), _lit(vector)
        with self._connect() as c:
            rows = c.execute(f'SELECT chunk_id, 1 - (embedding <=> %s::vector) FROM "{t}" '
                             'ORDER BY embedding <=> %s::vector LIMIT %s', (q, q, k)).fetchall()
        return [(r[0], float(r[1])) for r in rows]

    def collections(self):
        with self._connect() as c:
            rows = c.execute("SELECT tablename FROM pg_tables WHERE tablename LIKE 'rag_lab_rag_%'").fetchall()
            return [{"name": r[0].removeprefix("rag_lab_"), "count": c.execute(f'SELECT count(*) FROM "{r[0]}"').fetchone()[0]}
                    for r in rows]
