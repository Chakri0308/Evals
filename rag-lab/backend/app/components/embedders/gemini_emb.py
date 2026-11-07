import httpx
from pydantic import BaseModel, Field

from app.components.llms.gemini_llm import API, gemini_key
from app.core.capability import require_env
from app.core.registry import register

from ._base import BaseEmbedder, normalise


@register("embedder", "gemini", label="Gemini embeddings", order=4)
class GeminiEmbedder(BaseEmbedder):
    """Google Gemini embeddings (batchEmbedContents). Requires GEMINI_API_KEY."""

    class Params(BaseModel):
        model: str = Field("gemini-embedding-001", json_schema_extra={
            "examples": ["gemini-embedding-001", "text-embedding-004"]})

    def cache_id(self):
        return {"e": "gemini", "m": self.p.model}

    def available(self):
        return (True, "") if gemini_key() else require_env("GEMINI_API_KEY")

    def _embed(self, texts, task):
        out = []
        with httpx.Client(timeout=120) as c:
            for i in range(0, len(texts), 100):
                reqs = [{"model": f"models/{self.p.model}", "content": {"parts": [{"text": t}]}, "taskType": task}
                        for t in texts[i:i + 100]]
                r = c.post(f"{API}/models/{self.p.model}:batchEmbedContents", json={"requests": reqs},
                           headers={"x-goog-api-key": gemini_key()})
                if r.status_code != 200:
                    raise RuntimeError(f"Gemini embeddings {r.status_code}: {r.text[:200]}")
                out.extend(e["values"] for e in r.json()["embeddings"])
        return normalise(out)

    def embed_documents(self, texts):
        return self._embed(texts, "RETRIEVAL_DOCUMENT")

    def embed_query(self, text):
        return self._embed([text], "RETRIEVAL_QUERY")[0]
