import re

from app.core.registry import Component, register

_TOK = re.compile(r"\S+")


@register("tokenizer", "whitespace", label="Whitespace", order=5)
class WhitespaceTokenizer(Component):
    """Splits on whitespace. A crude, dependency-free fallback."""

    def encode(self, text: str) -> list[int]:
        return [hash(m.group()) & 0xFFFFFFF for m in _TOK.finditer(text)]

    def count(self, text: str) -> int:
        return sum(1 for _ in _TOK.finditer(text))

    def offsets(self, text: str) -> list[tuple[int, int]]:
        return [(m.start(), m.end()) for m in _TOK.finditer(text)]
