import json
import os

import httpx
from pydantic import Field

from app.core.registry import register

from ._base import BaseLLM, LLMParams


def ollama_base() -> str:
    return os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")


def ollama_models() -> list[str]:
    try:
        r = httpx.get(f"{ollama_base()}/api/tags", timeout=2)
        r.raise_for_status()
        return [m["name"] for m in r.json().get("models", [])]
    except Exception:
        return []


@register("llm", "ollama", label="Ollama (local)", order=1)
class OllamaLLM(BaseLLM):
    """Open-source models served locally by Ollama. Free, private, and works offline."""

    default_model = os.environ.get("OLLAMA_MODEL", "qwen2.5:1.5b")

    class Params(LLMParams):
        model: str = Field(os.environ.get("OLLAMA_MODEL", "qwen2.5:1.5b"), description="Ollama model tag",
                           json_schema_extra={"x-suggest": "ollama_models"})
        num_ctx: int = Field(8192, ge=1024, le=32768, description="Context window passed to Ollama")

    def available(self):
        try:
            httpx.get(f"{ollama_base()}/api/version", timeout=2).raise_for_status()
        except Exception:
            return False, f"Ollama is not reachable at {ollama_base()}. Start it with `ollama serve`."
        models = ollama_models()
        if models and self.p.model not in models and f"{self.p.model}:latest" not in models:
            return False, f"Model '{self.p.model}' is not pulled. Run `ollama pull {self.p.model}`."
        return True, ""

    def _body(self, system, user, stream, json_mode=False):
        b = {
            "model": self.p.model, "stream": stream,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "options": {"temperature": self.p.temperature, "num_predict": self.p.max_tokens,
                        "num_ctx": self.p.num_ctx},
            "keep_alive": "30m",
        }
        if json_mode:
            b["format"] = "json"
        return b

    async def stream(self, system, user):
        async with (
            httpx.AsyncClient(timeout=httpx.Timeout(600, connect=5)) as c,
            c.stream("POST", f"{ollama_base()}/api/chat", json=self._body(system, user, True)) as r,
        ):
            if r.status_code != 200:
                body = (await r.aread()).decode(errors="replace")
                raise RuntimeError(f"Ollama error {r.status_code}: {body[:300]}")
            async for line in r.aiter_lines():
                if not line.strip():
                    continue
                d = json.loads(line)
                if d.get("error"):
                    raise RuntimeError(f"Ollama: {d['error']}")
                t = d.get("message", {}).get("content", "")
                if t:
                    yield t
                if d.get("done"):
                    self._account(d.get("prompt_eval_count", 0), d.get("eval_count", 0))

    async def complete(self, system, user, json_mode=False):
        async with httpx.AsyncClient(timeout=httpx.Timeout(600, connect=5)) as c:
            r = await c.post(f"{ollama_base()}/api/chat", json=self._body(system, user, False, json_mode))
            if r.status_code != 200:
                raise RuntimeError(f"Ollama error {r.status_code}: {r.text[:300]}")
            d = r.json()
            self._account(d.get("prompt_eval_count", 0), d.get("eval_count", 0))
            return d.get("message", {}).get("content", "")
