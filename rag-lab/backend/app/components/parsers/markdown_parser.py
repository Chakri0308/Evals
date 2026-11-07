from markdown_it import MarkdownIt

from app.core.registry import Component, register
from app.core.types import Block, Document


@register("parser", "markdown", label="Markdown (markdown-it)", order=1)
class MarkdownParser(Component):
    """Parses Markdown with markdown-it-py and keeps the heading hierarchy.

    The document text is the original source, so chunk offsets map 1:1 to the file.
    """

    extensions = (".md", ".markdown", ".txt")

    def parse(self, data: bytes, name: str, doc_id: str) -> Document:
        text = data.decode("utf-8", errors="replace").replace("\r\n", "\n").replace("\r", "\n")
        lines = text.split("\n")
        line_starts = [0]
        for ln in lines:
            line_starts.append(line_starts[-1] + len(ln) + 1)

        def off(line_idx: int) -> int:
            return min(line_starts[min(line_idx, len(line_starts) - 1)], len(text))

        md = MarkdownIt("commonmark").enable("table")
        tokens = md.parse(text)
        blocks: list[Block] = []
        path: list[tuple[int, str]] = []
        i = 0
        while i < len(tokens):
            t = tokens[i]
            if t.type == "heading_open" and t.map:
                level = int(t.tag[1])
                title = tokens[i + 1].content.strip() if i + 1 < len(tokens) else ""
                while path and path[-1][0] >= level:
                    path.pop()
                path.append((level, title))
                s, e = off(t.map[0]), off(t.map[1])
                blocks.append(Block(kind="heading", start=s, end=e - 1 if e > s else e, level=level,
                                    heading_path=[p[1] for p in path]))
                i += 3
                continue
            # top-level block containers only (nesting level 0)
            if t.map and t.nesting >= 0 and t.level == 0 and t.type not in ("heading_open",):
                kind = {
                    "paragraph_open": "paragraph", "bullet_list_open": "list", "ordered_list_open": "list",
                    "fence": "code", "code_block": "code", "table_open": "table",
                    "blockquote_open": "quote", "hr": "other", "html_block": "other",
                }.get(t.type, "other")
                s, e = off(t.map[0]), off(t.map[1])
                e = max(s, e - 1)
                if text[s:e].strip():
                    blocks.append(Block(kind=kind, start=s, end=e, heading_path=[p[1] for p in path]))
            i += 1
        blocks.sort(key=lambda b: b.start)
        return Document(id=doc_id, name=name, kind="md", text=text, blocks=blocks, pages=0)
