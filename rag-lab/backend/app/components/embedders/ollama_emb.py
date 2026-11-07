import httpx
from pydantic import BaseModel, Field

from app.components.llms.ollama_llm import ollama_base, ollama_models
from app.core.registry import register

from ._base import BaseEmbedder, normalise


@register("embedder", "ollama", label="Ollama embeddings", order=3)
class OllamaEmbedder(BaseEmbedder):
    """Embeddings from a local Ollama server, e.g. nomic-embed-text (pull it first)."""

    class Params(BaseModel):
        model: str = Field("nomic-embed-text", description="Ollama embedding model")

    def cache_id(self):
        return {"e": "ollama", "m": self.p.model}

    def available(self):
        try:
            httpx.get(f"{ollama_base()}/api/version", timeout=2).raise_for_status()
        except Exception:
            return False, f"Ollama is not reachable at {ollama_base()}"
        models = ollama_models()
        if self.p.model not in models and f"{self.p.model}:latest" not in models:
            return False, f"run `ollama pull {self.p.model}`"
        return True, ""

    def embed_documents(self, texts):
        out = []
        with httpx.Client(timeout=120) as c:
            for i in range(0, len(texts), 32):
                r = c.post(f"{ollama_base()}/api/embed", json={"model": self.p.model, "input": texts[i:i + 32]})
                r.raise_for_status()
                out.extend(r.json()["embeddings"])
        return normalise(out)
