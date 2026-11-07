# RAG Lab — Plan

## Architecture

```
frontend/  React 19 + Vite + TS + Tailwind · zustand stores · TanStack Query
   src/api        fetch/SSE client + query hooks          src/store   app (panes, runs) · qset (question sets)
   src/lib        types, utils, diff, questionAnalysis     src/components  TopBar, QuestionBar, SettingsDialog,
                                                           panes/*, bottom/* (tabs load lazily), schema/*, ui/*
      │  /api  (dev: Vite proxy → :8765 · prod: same origin, the API serves frontend/dist)
      ▼
backend/app/
   main.py         create_app(): logging, CORS, routers, lifespan startup, SPA static serving
   config.py       paths, .env, CORS, log level, warm-up, frontend dist   (process-level, env-driven)
   startup.py      ingest sample guide · warm models + index sample (policy-aware, background)
   api/            one router per area: meta · documents · runs (+history, presets) · questions (+qsets) · evals
                   deps.py: doc_or_404 · stream_queue / stream_job (SSE with keep-alive + fatal events)
   core/
      registry.py     @register(kind, name) + Pydantic Params → JSON Schema; discover()
      pipeline.py     async orchestrator: per-stage trace, passthrough, fallbacks, not-ready reports
      settings.py     runtime defaults + access policy (.env → data/settings.json → UI), env locks
      capability.py   ready() = policy + available(); policy guard on every model call; require_env()
      models.py       local HF model cache + "is it usable here?" check (embedder, cross-encoder)
      embeddings.py   "provider:model" specs → embedder components
      providers.py    default-LLM resolution, capability report, connection tests
      vectorstore.py  backend-agnostic collections (ensure/search) over registered vector stores
      readiness.py    pre-flight checks + friendly report for semantic/hybrid
      storage.py      JsonStore (history, presets, qsets, evals) with safe ids
      defaults.py     default BM25 / Semantic / Hybrid panes
      cache.py · documents.py · indexes.py · types.py · interfaces.py
   components/<kind>/<name>.py   one file per component, auto-discovered
   qgen/           question generation, gold-span validation, "why is this a good test?" analysis
   evaluation/     retrieval metrics, batch runner
backend/tests/     conftest (fixtures) · helpers · test_{api,ingestion,retrieval,vector_stores,
                   policy_and_fallbacks,evaluation}.py
```

Request flow: UI → `api/*` router → `core.pipeline.run_pipeline` → components resolved by name from the
registry (LLM/embedder calls pass `capability` policy checks; vectors go through `core.vectorstore`) → SSE events
back to the UI.

Components are auto-imported by walking `app/components/**`. A new file containing a
`@register("chunker", "my_chunker")` class with a `Params` model shows up in
`GET /api/components` and the UI renders its form from the JSON Schema. No other
edits are needed.

## Data model

* `Document { id, name, kind, text, blocks[] }`: `text` is the full source text. Each block
  has char offsets `[start, end)`, `page` and `heading_path`. All chunk boundaries, gold spans
  and document-view bands use these char offsets.
* `Chunk { id: "C<n>", start, end, text, index_text, tokens, page, heading_path }`.
  `index_text` is the text that gets indexed and embedded. It has the heading path prepended
  when `prepend_heading_path` is on.
* `Hit { chunk_id, scores{bm25,dense,fused,rerank}, ranks{...}, dropped_by? }`.

## Pipeline stages and passthrough semantics (decisions)

| Stage | Disabled behaviour |
|---|---|
| query_transform | the original question is used as-is |
| chunking | **whole document = one chunk** (long-context baseline) |
| retrieval | **closed-book**: no context; fusion/rerank/filter are skipped |
| fusion | a single list passes through; for hybrid, the lists are interleaved round-robin |
| rerank | order unchanged; top_k kept |
| context_filter | everything kept |
| prompt | a bare `{context}\n\n{question}` |
| generation | **retrieval-only** run: no LLM call |

* Multi-query / decomposition: each sub-query is retrieved and the per-retriever lists are
  merged by max score. HyDE: the hypothetical answer is used for the dense query, and the
  original question for BM25.
* The query-transform LLM and the LLM reranker use the pane's generation provider/model.

## Paraphrase robustness (measured)

On 30 paraphrased questions about the sample guide (the questions avoid the guide's own wording), measured at
heading_aware 256:

| Setup | hit@1 | hit@5 | MRR |
|---|---|---|---|
| BM25 | 0.67 | 0.83 | 0.73 |
| Semantic, bge-small (Chroma = in-memory) | 0.87 | 1.00 | 0.91 |
| Semantic, bge-base | 0.80 | 1.00 | 0.90 |
| Semantic + LLM-generated questions indexed per chunk (qwen2.5:1.5b) | 0.60 | 0.97 | 0.75 |
| **Semantic + cross-encoder rerank (MiniLM)** | **0.90** | **1.00** | **0.95** |

Decision: the default Semantic pane uses bge-small with Chroma and has the cross-encoder reranker turned on.

## Swappable providers, vector DBs and no-LLM mode (decisions)

* **Everything by name.** LLMs, embedders and vector stores are registered components. Defaults live in `.env`, and
  `data/settings.json` overrides them from the UI. Retrievers and the judge accept `"default"`, which means "follow
  Settings".
* **Secrets only in `.env`.** Store and LLM components read keys and DSNs from the environment, never from pane
  params, so presets, history and exports never contain secrets.
* **Policy is enforced at the base classes.** `BaseLLM` and `BaseEmbedder` wrap every subclass's call methods with
  a policy check, so nothing can call a model while it's switched off, even through a new component that forgets to
  check. An env `false` locks the switch.
* **Missing capability means fall back, not crash.** Components raise `Unavailable(reason)`. The pipeline marks
  that stage skipped and notes the fallback. Generation falls back to the extractive answerer (also on run-time
  LLM errors before the first token). Semantic/hybrid raise `NotReady(report)`: the pane shows the pre-flight
  report and the remaining stages are skipped, with no red error. Batch eval leaves not-ready rows out of the
  metrics instead of scoring them 0.
* **Vector stores are tested for agreement.** Chroma, FAISS and in-memory return the same ranking. pgvector was
  checked against a live Postgres (pgserver). Pinecone is tested against a fake client (no key on this machine).

## Look

The UI uses a Citi-inspired palette: brand blue `#255be3`, navy `#0f1632`, white cards with 16px radius and a soft
`0 10px 40px` shadow, pill CTAs, a blue band the pane cards overlap, boxed uppercase section labels and a navy
footer. Dark mode is a navy variant. No Citi logos or proprietary fonts are bundled (Inter is the fallback sans,
with Georgia italic for the display line). Pane colours stay blue, green and amber so colour-blind readers can
tell them apart.

## LLM providers (decision)

There are no cloud keys on this machine, so **Ollama is the default** (`qwen2.5:1.5b`, a small
model that runs on CPU). Anthropic and OpenAI providers are enabled when their keys are in `.env`.
An `extractive` provider (no LLM: it quotes the top sentences, with citations) keeps the app usable
when Ollama is not running. The question generator and the judge each have an LLM mode and a
heuristic (offline) mode.

## Caching

* parse: `data/docs/<sha16>.json` (keyed by file hash)
* chunks: `data/chunks/<hash(doc, tokenizer, chunker, params)>.json`
* embeddings: `data/emb/<hash(chunkset, embedder, params)>.npy`
* **vector database: Chroma** (`data/chroma`, HNSW, cosine). There is one collection per (chunk set × embedding
  model). Each record stores the chunk id, vector, indexed text and metadata (doc, char span, tokens, page, heading).
  A collection is built the first time it is needed and reused across restarts. Semantic and hybrid retrievers
  query it by default; `vector_store: in_memory` switches to exact NumPy search for comparison (rankings match).
  `GET /api/vectorstore` lists the collections.
* BM25: in memory, keyed by chunkset + variant/k1/b (rebuilding takes milliseconds)
* retrieval/rerank/generation: always recomputed

## Milestones

1. Skeleton + registry + schema forms ✔
2. Ingestion (MD/PDF parsers, 6 chunkers, doc view, chunk preview) ✔
3. Retrieval (BM25, dense, hybrid + RRF/alpha, caching, chunk cards) ✔
4. Full pipeline (rerankers, query transforms, filters, prompt, streaming, trace) ✔
5. 3-pane split screen, flow strip, ≠ badges, sync, auto-run, compare ✔
6. Question generator (16 categories, LLM + heuristic, validation) ✔
7. Batch eval (Hit@k, Recall@k, MRR, nDCG, judge, leaderboard, per-category) ✔
8. Polish, history, presets, README ✔

## Running

`dev.ps1` / `dev.sh` start the backend on :8765 (port 8000 is used by other software on this machine) and the frontend on :5173. `make dev` and
`make test` work wherever make is installed.
