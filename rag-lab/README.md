# RAG Lab

RAG Lab is a side-by-side workbench for testing RAG pipelines. Upload a style guide (`.md` or `.pdf`) and ask a question.
Up to three fully configurable pipelines answer it in parallel: BM25, semantic and hybrid by default. You can inspect
every stage (chunks, scores, reranking, the exact prompt, the streamed answer), switch any stage off, generate a
16-category test set and batch-evaluate your configs.

The app runs fully locally by default: **Ollama** (`qwen2.5:1.5b`) handles generation, **sentence-transformers**
(`BAAI/bge-small-en-v1.5`) handles embeddings, and **Chroma** stores the vectors. No API keys are required. The LLM
(Claude, OpenAI, Gemini, Azure, any OpenAI-compatible server) and the vector DB (Chroma, FAISS, pgvector, Pinecone)
can be switched without code changes, and a no-LLM mode keeps BM25 answering on locked-down machines (see below).

## Quick start

| | Windows | macOS / Linux |
|---|---|---|
| **Develop** (hot reload, UI on :5173, API on :8765) | `./dev.ps1` | `make dev` or `./dev.sh` |
| **Production** (one process: UI + API on :8765) | `./prod.ps1` (`-Rebuild` to rebuild the UI) | `make prod` or `./prod.sh` |
| **Container** | `docker build -t rag-lab .` then `docker run -p 8765:8765 --env-file .env -v rag-lab-data:/app/data rag-lab` | same |

The first run creates `backend/.venv` (CPU PyTorch) and installs the frontend packages. Prerequisites: Python 3.11+,
Node 18+ and, optionally, [Ollama](https://ollama.com) with a pulled model (`ollama pull qwen2.5:1.5b`). Without Ollama
or a cloud key, answers fall back to extractive quotes. Copy `.env.example` to `.env` to configure providers, the vector
DB, access policy, CORS and logging.

In production the API serves the built UI (`frontend/dist`) on the same origin, so no CORS or proxy is needed. Run one
worker: caches and SSE streams are in-process. Put a reverse proxy in front for TLS. Set `RAG_LAB_HOST=0.0.0.0` to
listen on all interfaces.

## Project layout

```
rag-lab/
  backend/app/   main.py (app factory) · config.py · startup.py
                 api/ (routers) · core/ (pipeline, registry, settings, storage, vector stores)
                 components/<kind>/<name>.py (one file per component) · qgen/ · evaluation/
  backend/tests/ API, ingestion, retrieval, vector stores, policy/fallbacks, evaluation
  frontend/src/  api/ · store/ · lib/ · components/ (panes, bottom tabs, settings, ui)
  samples/  scripts/ (shared run steps)  dev.* / prod.*  Makefile  Dockerfile  .env.example
```

`PLAN.md` describes the architecture and the request flow.

## Using it

| Where | What |
|---|---|
| Question bar | Type a question, then press `Ctrl/⌘+Enter` to run all panes. **Auto-run** re-runs a pane 600 ms after its config changes. |
| Flow strip | One node per stage: status, component, ms and item count. Click a node to configure it and see its last output. Hover ⏻ to switch it off. |
| ≠ badges | Settings that differ from the other panes. **Sync** applies a change to every pane, except the retrieval type and fusion. |
| Answer | Streams token by token. `[C3]` citations are clickable and jump to the chunk. The footer shows per-stage latency, tokens and cost. |
| Chunks | Rank, ID, source location, tokens, BM25/cosine/fused/rerank scores, rank movement after rerank, and cited-or-not. Query terms are highlighted. **Show in document** opens the chunk in the document view. **dropped** reveals chunks that were cut. |
| Compare | All answers side by side, a Venn of retrieved chunks, Jaccard similarity, a chunk×pane rank matrix, a metrics table and a word-level answer diff. |
| Question Generator | 16 categories with explanations. LLM or template mode. Gold spans are validated against the document. Every question is then **analysed**: a *Tests* badge (BM25 / Semantic / Hybrid / Hard / Baseline / Reasoning / Abstain) from the measured BM25, semantic and hybrid ranks of its answer chunk; an expandable *Why* panel with a terminology map (each question word: in the answer passage, only elsewhere = distractor, other word form = BM25 miss, not in the document = paraphrase), the passage words the question avoided, and what a failure would mean; a suggestions card with the best checks per retriever and coverage advice; and a ⚠ when a question doesn't test what its category promises. It re-analyses automatically after edits, using the Semantic pane's chunking and embedding model. With embeddings off it falls back to BM25 rank + wording (marked ~). Edit cells inline, press ▶ to run a question, import/export JSON or CSV (CSV includes tests, why and ranks). |
| Batch Eval | Hit@k, Recall@k, MRR, nDCG@k, plus judge scores (heuristic or LLM), p50/p95 latency and tokens. The per-category chart shows which strategy fails where. Drill into any question. |
| Document view | The parsed document with chunk bands (overlaps striped), a size histogram, and a live re-split preview as you change chunking params. |

Shortcuts: `Ctrl/⌘+Enter` run · `Ctrl/⌘+1/2/3` pane count · `Ctrl/⌘+B` toggle the bottom panel · `/` focus the question · `Esc` close.

**Vector database.** Semantic and hybrid retrieval embed every chunk once into a Chroma collection. The vector is
stored with the chunk text and metadata (heading, page, char span), and the collection is reused across runs and
restarts. Each chunking setting and embedding model gets its own collection. The pane trace shows which collection a
run used, and `GET /api/vectorstore` lists them all. Set **Vector store → in_memory** on the Retrieve stage to compare
against exact NumPy search. The default Semantic pane also reranks with a cross-encoder, which helps with questions
worded differently from the guide (see the measurements in PLAN.md).

Turning a stage off makes it a passthrough. **Retrieval off** gives a closed-book baseline, **chunking off** puts the
whole document in context, and **generation off** gives a retrieval-only run.

## Switching LLMs and vector databases

Everything is chosen by name, so switching never needs a code change. Use the gear button in the top bar (or the
mode chip next to it), or set the defaults in `.env` (see `.env.example`).

| | Options | Configure in `.env` |
|---|---|---|
| **LLM** | `ollama` (default), `anthropic` (Claude), `openai`, `gemini`, `azure_openai`, `openai_compatible` (Groq, OpenRouter, Together, Mistral, DeepSeek, vLLM, LM Studio, a company gateway...), `extractive` (no LLM) | `LLM_PROVIDER`, `LLM_MODEL` + that provider's key |
| **Embeddings** | `local:<hub id or folder>`, `ollama:<model>`, `openai:<model>`, `gemini:<model>` | `EMBEDDING_MODEL` |
| **Vector DB** | `chroma` (default, embedded), `faiss`, `pgvector`, `pinecone`, `in_memory` | `VECTOR_STORE` + `PGVECTOR_DSN` / `PINECONE_API_KEY` / ... |

* **Settings → Default LLM → Apply to all panes** points every pane's Generate stage at one provider and model.
  Each pane can still use its own provider for comparisons.
* Semantic and hybrid retrievers default to `vector_store: default` and `embedding_model: default`, so they follow
  Settings. Pick a specific value on a pane to compare, for example Chroma against pgvector.
* Each (chunk set x embedding model) gets its own collection in the chosen store, built automatically on first use
  and reused after that. `GET /api/vectorstore` lists them.
* Keys and connection strings are only read from `.env`. The UI never stores them.
* Optional DB clients: `pip install -r backend/requirements-optional.txt` (faiss-cpu, psycopg, pinecone).

## Office / no-LLM mode

For machines where LLM calls (or any model calls) aren't allowed:

```ini
RAG_LAB_ALLOW_LLM=false          # never call an LLM
RAG_LAB_ALLOW_EMBEDDINGS=false   # never load or call embedding/reranker models
RAG_LAB_OFFLINE=true             # both, plus no model downloads at all
```

A switch set to `false` in `.env` is **locked**: the UI shows a lock and can't turn it back on. Without the lock, the
same switches are also available in Settings. In this mode:

* **BM25 runs end to end.** Retrieval, prompt building and an answer that quotes the best-matching sentences from
  the retrieved chunks, with `[C#]` citations. The answer is marked *no-LLM answer*. No model is called. A hard guard
  in the LLM base class makes any call raise instead, so a code path can't slip through.
* **Semantic and hybrid run a pre-flight check instead of failing.** Document chunked, BM25 index, vector DB
  connection, embedding model, stored vectors, answer LLM. They report, in a lighter tone, the one or two things
  still missing ("All the pipes are connected and the water's on. I'm just missing the tap...") and what to change.
  Once the missing piece is there, the same pane just runs.
* **Everything else falls back on its own:** LLM query rewrites use the original question, LLM and cross-encoder
  rerankers keep the retrieval order, the semantic chunker falls back to heading-aware, the question generator uses
  templates, and the LLM judge uses the heuristic judge. Each fallback is noted in the pane.
* If an LLM call fails at run time (bad key, network), the answer also falls back to the extractive answer rather
  than erroring.
* Local models can be copied onto the machine: `EMBEDDING_MODEL=local:C:\models\bge-small-en-v1.5`.

## Adding a component (one file, no UI changes)

```python
# backend/app/components/chunkers/paragraph.py
from pydantic import Field
from app.core.registry import Component, register
from ._base import ChunkParams, finalize, split_by_sep

class Params(ChunkParams):
    keep_short: bool = Field(True, description="Keep 1-line paragraphs")

@register("chunker", "paragraph", label="Paragraph")
class ParagraphChunker(Component):
    """One chunk per blank-line separated paragraph."""
    Params = Params

    def chunk(self, doc, ctx):
        spans = split_by_sep(doc.text, 0, len(doc.text), "\n\n")
        return finalize(doc, spans, ctx.tokenizer, self.p.prepend_heading_path)
```

The backend reloads, `GET /api/components` lists it, and its config form is rendered from the JSON Schema.
The same applies to retrievers, fusers, rerankers, query transforms, filters, prompts, LLMs, embedders, judges, tokenizers
and **vector stores**:

* **New LLM provider** (Bedrock, Vertex, Cohere...): subclass `BaseLLM` in `app/components/llms/`, implement `stream()`
  (and `available()` for the key check). The policy guard, fallbacks and the Settings list come for free.
* **New vector DB** (Qdrant, Weaviate, Milvus, Elasticsearch...): subclass `VectorStore` in
  `app/components/vector_stores/` and implement `available / count / reset / upsert / query / collections`. Copy
  `in_memory.py` as a template.

## Checks

```bash
make check        # ruff + oxlint + TypeScript + pytest  (or individually: make lint / typecheck / test)
# Windows without make:
cd backend;  .venv/Scripts/python -m ruff check app tests;  .venv/Scripts/python -m pytest
cd frontend; npm run check;  npm run build
# pgvector against a live database:  PGVECTOR_TEST_DSN=postgresql://... pytest -k pgvector
```

The tests cover the HTTP API (streamed runs, stores and path safety, settings locks, SPA serving), parsing, chunk size
and overlap for every chunker, BM25/dense ranking, RRF and alpha fusion, vector stores agreeing with each other
(Chroma, FAISS, in-memory; pgvector live; Pinecone against a fake client), no-LLM mode, pre-flight reports, provider
key checks, retrieval metrics, gold-span location, the 16-category generator and question analysis. Dev tools are in
`backend/requirements-dev.txt`.
