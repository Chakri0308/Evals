import numpy as np
from pydantic import BaseModel, Field

from app.core import models
from app.core.registry import register

from ._base import BaseEmbedder


@register("embedder", "sentence_transformers", label="Local (sentence-transformers)", order=1)
class STEmbedder(BaseEmbedder):
    """Local embeddings on CPU with sentence-transformers. The default is BAAI/bge-small-en-v1.5. Accepts a Hub id or a local folder path."""

    class Params(BaseModel):
        model: str = Field("BAAI/bge-small-en-v1.5", description="Hub id or local folder",
                           json_schema_extra={"examples": ["BAAI/bge-small-en-v1.5", "BAAI/bge-base-en-v1.5",
                                                           "sentence-transformers/all-MiniLM-L6-v2"]})
        query_instruction: bool = Field(True, description="Prefix queries with the BGE retrieval instruction")

    def cache_id(self):
        return {"e": "st", "m": self.p.model}

    def available(self):
        if models.is_loaded("embedder", self.p.model):
            return True, "loaded"
        return models.status(self.p.model)

    def embed_documents(self, texts):
        m = models.load("embedder", self.p.model)
        v = m.encode(texts, batch_size=32, normalize_embeddings=True, show_progress_bar=False)
        return np.asarray(v, dtype=np.float32)

    def embed_query(self, text):
        q = text
        if self.p.query_instruction and "bge" in self.p.model.lower():
            q = "Represent this sentence for searching relevant passages: " + text
        return self.embed_documents([q])[0]
