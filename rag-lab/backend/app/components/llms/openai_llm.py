"""OpenAI, Azure OpenAI and any OpenAI-compatible endpoint (Groq, OpenRouter, Together, Mistral, DeepSeek,
vLLM, LM Studio, ...). They share the Chat Completions wire format, so one streaming implementation serves all."""
import os

from pydantic import Field

from app.core.capability import require_env
from app.core.registry import register

from ._base import BaseLLM, LLMParams


class _ChatCompletions(BaseLLM):
    def client(self):  # pragma: no cover - overridden
        raise NotImplementedError

    async def ping(self):
        ok, why = self.available()
        if not ok:
            return ok, why
        try:
            await self.client().models.list()
            return True, "connected"
        except Exception as e:  # noqa: BLE001
            return False, f"{type(e).__name__}: {str(e)[:200]}"

    async def stream(self, system, user):
        resp = await self.client().chat.completions.create(
            model=self.p.model, temperature=self.p.temperature, max_tokens=self.p.max_tokens, stream=True,
            stream_options={"include_usage": True},
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}])
        async for ev in resp:
            if ev.choices and ev.choices[0].delta.content:
                yield ev.choices[0].delta.content
            if getattr(ev, "usage", None):
                self._account(ev.usage.prompt_tokens, ev.usage.completion_tokens)


@register("llm", "openai", label="OpenAI", order=3)
class OpenAILLM(_ChatCompletions):
    """OpenAI chat models. Requires OPENAI_API_KEY in .env."""

    default_model = "gpt-4o-mini"

    class Params(LLMParams):
        model: str = Field("gpt-4o-mini", description="OpenAI model id",
                           json_schema_extra={"examples": ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"]})

    def available(self):
        return require_env("OPENAI_API_KEY")

    def client(self):
        from openai import AsyncOpenAI

        return AsyncOpenAI()


@register("llm", "azure_openai", label="Azure OpenAI", order=5)
class AzureOpenAILLM(_ChatCompletions):
    """Azure OpenAI deployments. Needs AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY in .env; model = deployment name."""

    default_model = os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini")

    class Params(LLMParams):
        model: str = Field(os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini"), description="Deployment name")

    def available(self):
        return require_env("AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_KEY")

    def client(self):
        from openai import AsyncAzureOpenAI

        return AsyncAzureOpenAI(azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
                                api_key=os.environ["AZURE_OPENAI_API_KEY"],
                                api_version=os.environ.get("AZURE_OPENAI_API_VERSION", "2024-10-21"))


@register("llm", "openai_compatible", label="OpenAI-compatible (any)", order=6)
class OpenAICompatibleLLM(_ChatCompletions):
    """Any server that speaks the OpenAI Chat Completions API: Groq, OpenRouter, Together, Mistral, DeepSeek, vLLM, LM Studio, a company gateway... Set OPENAI_COMPATIBLE_BASE_URL (+ OPENAI_COMPATIBLE_API_KEY) in .env."""

    default_model = os.environ.get("OPENAI_COMPATIBLE_MODEL", "")

    class Params(LLMParams):
        model: str = Field(os.environ.get("OPENAI_COMPATIBLE_MODEL", "llama-3.1-8b-instant"),
                           description="Model id as the server names it",
                           json_schema_extra={"examples": ["llama-3.1-8b-instant", "mistral-small-latest",
                                                           "deepseek-chat", "meta-llama/llama-3.1-8b-instruct"]})

    def available(self):
        return require_env("OPENAI_COMPATIBLE_BASE_URL", example="https://api.groq.com/openai/v1")

    def client(self):
        from openai import AsyncOpenAI

        return AsyncOpenAI(base_url=os.environ["OPENAI_COMPATIBLE_BASE_URL"],
                           api_key=os.environ.get("OPENAI_COMPATIBLE_API_KEY") or "not-needed")
