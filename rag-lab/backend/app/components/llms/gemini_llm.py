import json
import os

import httpx
from pydantic import Field

from app.core.capability import require_env
from app.core.registry import register

from ._base import BaseLLM, LLMParams

API = "https://generativelanguage.googleapis.com/v1beta"


def gemini_key() -> str:
    return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or ""


@register("llm", "gemini", label="Google Gemini", order=4)
class GeminiLLM(BaseLLM):
    """Gemini models via the Google AI (Generative Language) REST API. Requires GEMINI_API_KEY in .env."""

    default_model = "gemini-2.5-flash"

    class Params(LLMParams):
        model: str = Field("gemini-2.5-flash", description="Gemini model id",
                           json_schema_extra={"examples": ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"]})

    def available(self):
        return (True, "") if gemini_key() else require_env("GEMINI_API_KEY")

    async def ping(self):
        ok, why = self.available()
        if not ok:
            return ok, why
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.get(f"{API}/models", headers={"x-goog-api-key": gemini_key()})
        return (True, "key accepted") if r.status_code == 200 else (False, f"Gemini API {r.status_code}: {r.text[:160]}")

    def _body(self, system, user, json_mode=False):
        cfg = {"temperature": self.p.temperature, "maxOutputTokens": self.p.max_tokens}
        if json_mode:
            cfg["responseMimeType"] = "application/json"
        return {"systemInstruction": {"parts": [{"text": system}]} if system else None,
                "contents": [{"role": "user", "parts": [{"text": user}]}], "generationConfig": cfg}

    def _usage(self, d):
        u = d.get("usageMetadata") or {}
        return u.get("promptTokenCount", 0), u.get("candidatesTokenCount", 0)

    async def stream(self, system, user):
        body = {k: v for k, v in self._body(system, user).items() if v is not None}
        url = f"{API}/models/{self.p.model}:streamGenerateContent?alt=sse"
        last = None
        async with (
            httpx.AsyncClient(timeout=httpx.Timeout(300, connect=10)) as c,
            c.stream("POST", url, json=body, headers={"x-goog-api-key": gemini_key()}) as r,
        ):
            if r.status_code != 200:
                raise RuntimeError(f"Gemini error {r.status_code}: {(await r.aread()).decode(errors='replace')[:300]}")
            async for line in r.aiter_lines():
                if not line.startswith("data:"):
                    continue
                d = json.loads(line[5:])
                last = d
                for cand in d.get("candidates", [])[:1]:
                    for part in cand.get("content", {}).get("parts", []):
                        if part.get("text"):
                            yield part["text"]
        if last:
            self._account(*self._usage(last))

    async def complete(self, system, user, json_mode=False):
        body = {k: v for k, v in self._body(system, user, json_mode).items() if v is not None}
        async with httpx.AsyncClient(timeout=httpx.Timeout(300, connect=10)) as c:
            r = await c.post(f"{API}/models/{self.p.model}:generateContent", json=body,
                             headers={"x-goog-api-key": gemini_key()})
        if r.status_code != 200:
            raise RuntimeError(f"Gemini error {r.status_code}: {r.text[:300]}")
        d = r.json()
        self._account(*self._usage(d))
        parts = (d.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
        return "".join(p.get("text", "") for p in parts)
