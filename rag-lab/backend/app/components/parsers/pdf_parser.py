from collections import Counter

from pydantic import BaseModel, Field

from app.core.registry import Component, register
from app.core.types import Block, Document


@register("parser", "pymupdf", label="PDF (PyMuPDF)", order=2)
class PdfParser(Component):
    """Extracts PDF text with PyMuPDF. Keeps page numbers and detects headings from font size/weight."""

    extensions = (".pdf",)

    class Params(BaseModel):
        heading_size_ratio: float = Field(1.15, ge=1.0, le=2.0, description="Font size / body size to count as heading")

    def parse(self, data: bytes, name: str, doc_id: str) -> Document:
        import fitz  # pymupdf

        pdf = fitz.open(stream=data, filetype="pdf")
        raw = []  # (page, text, size, bold)
        sizes: Counter = Counter()
        for pno, page in enumerate(pdf, start=1):
            d = page.get_text("dict")
            for b in d.get("blocks", []):
                if b.get("type") != 0:
                    continue
                lines_txt, line_sizes, bold_chars, total_chars = [], [], 0, 0
                for ln in b.get("lines", []):
                    t = "".join(s["text"] for s in ln.get("spans", []))
                    for s in ln.get("spans", []):
                        n = len(s["text"].strip())
                        sizes[round(s["size"], 1)] += n
                        line_sizes.append(s["size"])
                        total_chars += n
                        if s.get("flags", 0) & 16 or "bold" in s.get("font", "").lower():
                            bold_chars += n
                    if t.strip():
                        lines_txt.append(t.strip())
                if not lines_txt:
                    continue
                txt = " ".join(lines_txt) if len(lines_txt) > 1 else lines_txt[0]
                raw.append((pno, txt, max(line_sizes) if line_sizes else 0,
                            total_chars > 0 and bold_chars / total_chars > 0.8))
        body = sizes.most_common(1)[0][0] if sizes else 10
        ratio = self.p.heading_size_ratio
        heading_sizes = sorted({round(sz, 1) for _, t, sz, _ in raw if sz >= body * ratio}, reverse=True)

        text_parts: list[str] = []
        blocks: list[Block] = []
        path: list[tuple[int, str]] = []
        pos = 0
        for pno, txt, sz, bold in raw:
            is_heading = len(txt) < 120 and (sz >= body * ratio or (bold and len(txt) < 80 and not txt.endswith(".")))
            s = pos
            text_parts.append(txt)
            pos += len(txt)
            if is_heading:
                if round(sz, 1) in heading_sizes:
                    level = min(heading_sizes.index(round(sz, 1)) + 1, 6)
                else:
                    level = min(len(heading_sizes) + 1, 6)
                while path and path[-1][0] >= level:
                    path.pop()
                path.append((level, txt))
                blocks.append(Block(kind="heading", start=s, end=pos, page=pno, level=level,
                                    heading_path=[p[1] for p in path]))
            else:
                blocks.append(Block(kind="paragraph", start=s, end=pos, page=pno,
                                    heading_path=[p[1] for p in path]))
            text_parts.append("\n\n")
            pos += 2
        return Document(id=doc_id, name=name, kind="pdf", text="".join(text_parts), blocks=blocks,
                        pages=len(pdf))
