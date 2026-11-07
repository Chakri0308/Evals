
from pydantic import Field

from app.core.capability import require_env
from app.core.registry import register

from ._base import BaseLLM, LLMParams


@register("llm", "anthropic", label="Anthropic Claude", order=2)
class AnthropicLLM(BaseLLM):
    """Claude models via the Anthropic API. Requires ANTHROPIC_API_KEY in .env."""

    default_model = "claude-haiku-5-5"

    class Params(LLMParams):
        model: str = Field("claude-haiku-5-5", description="Claude model id",
                           json_schema_extra={"examples": ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5",
                                                           "claude-fable-5-1"]})

    def available(self):
        return require_env("ANTHROPIC_API_KEY")

    async def ping(self):
        ok, why = self.available()
        if not ok:
            return ok, why
        try:
            from anthropic import AsyncAnthropic

            await AsyncAnthropic().models.list(limit=1)
            return True, "key accepted"
        except Exception as e:  # noqa: BLE001
            return False, f"{type(e).__name__}: {str(e)[:200]}"

    async def stream(self, system, user):
        from anthropic import AsyncAnthropic

        client = AsyncAnthropic()
        async with client.messages.stream(model=self.p.model, max_tokens=self.p.max_tokens,
                                          temperature=self.p.temperature, system=system,
                                          messages=[{"role": "user", "content": user}]) as s:
            async for t in s.text_stream:
                yield t
            final = await s.get_final_message()
            self._account(final.usage.input_tokens, final.usage.output_tokens)
