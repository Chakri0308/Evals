"""Document storage and chunk-set caching."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from .cache import DATA_DIR, cached_json, stable_hash
from .interfaces import Ctx
from .registry import all_specs, create, validate_params
from .types import Chunk, ChunkSet, Document

_docs: dict[str, Document] = {}


def parse_upload(data: bytes, filename: str) -> tuple[Document, bool]:
    doc_id = stable_hash(data)
    existing = load_doc(doc_id)
    if existing:
        return existing, True
    ext = Path(filename).suffix.lower()
    parser = None
    for spec in all_specs()["parser"]:
        if ext in getattr(spec.cls, "extensions", ()):
            parser = create("parser", spec.name)
            break
    if parser is None:
        raise ValueError(f"Unsupported file type '{ext}'. Upload .md or .pdf")
    doc = parser.parse(data, filename, doc_id)
    tok = create("tokenizer", "tiktoken")
    doc.meta["tokens"] = tok.count(doc.text)
    doc.meta["sections"] = sum(1 for b in doc.blocks if b.kind == "heading")
    (DATA_DIR / "uploads" / f"{doc_id}{ext}").write_bytes(data)
    (DATA_DIR / "docs" / f"{doc_id}.json").write_text(doc.model_dump_json(), encoding="utf-8")
    _docs[doc_id] = doc
    return doc, False


def load_doc(doc_id: str) -> Optional[Document]:
    if doc_id in _docs:
        return _docs[doc_id]
    p = DATA_DIR / "docs" / f"{doc_id}.json"
    if not p.exists():
        return None
    doc = Document.model_validate_json(p.read_text(encoding="utf-8"))
    _docs[doc_id] = doc
    return doc


def list_docs() -> list[dict]:
    out = []
    for p in sorted((DATA_DIR / "docs").glob("*.json"), key=lambda p: -p.stat().st_mtime):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            out.append(doc_stats(Document.model_validate(d)))
        except Exception:
            continue
    return out


def doc_stats(doc: Document) -> dict:
    return {"id": doc.id, "name": doc.name, "kind": doc.kind, "pages": doc.pages,
            "tokens": doc.meta.get("tokens", 0), "sections": doc.meta.get("sections", 0),
            "chars": len(doc.text)}


def get_chunkset(doc: Document, component: str, params: dict, enabled: bool = True,
                 tokenizer: str = "tiktoken") -> tuple[ChunkSet, bool]:
    tok = create("tokenizer", tokenizer)
    if not enabled:
        key = stable_hash(doc.id, tokenizer, "__whole__")
        c = Chunk(id="C1", index=0, start=0, end=len(doc.text), text=doc.text, index_text=doc.text,
                  tokens=tok.count(doc.text), page=1 if doc.pages else None, heading_path=[])
        return ChunkSet(key=key, doc_id=doc.id, chunks=[c]), True
    vp = validate_params("chunker", component, params).model_dump(by_alias=True)
    from .registry import get_spec

    version = getattr(get_spec("chunker", component).cls, "version", 1)  # bump to invalidate cached chunks
    key = stable_hash(doc.id, tokenizer, component, vp, version)

    def compute():
        chunker = create("chunker", component, vp)
        chunks = chunker.chunk(doc, Ctx(doc=doc, tokenizer=tok))
        return ChunkSet(key=key, doc_id=doc.id, chunks=chunks)

    return cached_json("chunks", key, compute, lambda v: v.model_dump(), ChunkSet.model_validate)
