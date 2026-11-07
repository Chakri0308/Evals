import os

from pydantic import BaseModel, Field

from app.core.capability import require_env
from app.core.registry import register

from ._base import BaseEmbedder, normalise


@register("embedder", "openai", label="OpenAI embeddings", order=2)
class OpenAIEmbedder(BaseEmbedder):
    """OpenAI embeddings API (also Azure / OpenAI-compatible servers via OPENAI_EMBEDDINGS_BASE_URL). Requires OPENAI_API_KEY."""

    class Params(BaseModel):
        model: str = Field("text-embedding-3-small", json_schema_extra={
            "examples": ["text-embedding-3-small", "text-embedding-3-large"]})

    def cache_id(self):
        return {"e": "openai", "m": self.p.model, "u": os.environ.get("OPENAI_EMBEDDINGS_BASE_URL", "")}

    def available(self):
        return require_env("OPENAI_API_KEY")

    def embed_documents(self, texts):
        from openai import OpenAI

        client = OpenAI(base_url=os.environ.get("OPENAI_EMBEDDINGS_BASE_URL") or None)
        out = []
        for i in range(0, len(texts), 256):
            r = client.embeddings.create(model=self.p.model, input=texts[i:i + 256])
            out.extend(d.embedding for d in r.data)
        return normalise(out)
