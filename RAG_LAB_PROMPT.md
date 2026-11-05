# Build "RAG Lab": a side-by-side RAG testing workbench

## Role and goal

You are a senior full-stack engineer and product designer. Build **RAG Lab**, a local web app. It lets me:

1. Upload a style guide (`.md` or `.pdf`) as a knowledge base.
2. Ask a question and run it through a fully configurable RAG pipeline.
3. See **up to 3 pipeline configurations side by side** in a split-screen layout, with all of them running in parallel on the same question.
4. Inspect every stage of each pipeline (chunks, retrieval scores, reranking, the final prompt, the answer). Any stage can be switched off to isolate problems and trace how the answer was produced.
5. Generate a full **test question set** from the document (single-hop, multi-hop, and the other categories listed below), then batch-evaluate my configurations against it.

The most important features are the comparison between **BM25 keyword search, semantic (dense) search, and hybrid search**, and the ability to see exactly which chunks drove each answer.

Before writing code, read this whole spec. Then write `PLAN.md` with your architecture, file tree and milestone plan, and build milestone by milestone. At the end of each milestone, run it and verify it works before moving on.

---

## 1. Core design principle: small, swappable components

Everything in the pipeline is a **pluggable component** behind a small interface. Adding or replacing a chunker, retriever, reranker, embedder or LLM must take **one new file** and no changes anywhere else, including the UI.

**How to achieve this:**

- Each stage type has an abstract interface (a Python `Protocol` or ABC): `Parser`, `Chunker`, `Embedder`, `Retriever`, `Fuser`, `Reranker`, `QueryTransformer`, `PromptBuilder`, `LLM`, `Judge`.
- Each implementation registers itself with a decorator. Example: `@register("chunker", "recursive")`.
- Each implementation declares its parameters as a **Pydantic config model**. Include defaults, min/max values, and descriptions.
- The backend exposes `GET /api/components`. It returns every registered component per stage, with its JSON Schema.
- **The frontend renders the control panels automatically from those JSON Schemas:**
  - int/float with bounds → slider plus number input
  - enum → segmented control or select
  - bool → switch
  - string → input
- A new component therefore appears in the UI automatically.
- A pipeline is a plain, serializable config object (JSON). Pipelines can be saved, loaded, duplicated and exported as presets.

```
PipelineConfig {
  name, color,
  stages: {
    query_transform: { enabled, component, params },
    chunking:        { enabled, component, params },
    retrieval:       { enabled, component, params },
    fusion:          { enabled, component, params },
    rerank:          { enabled, component, params },
    context_filter:  { enabled, component, params },
    prompt:          { enabled, component, params },
    generation:      { enabled, component, params }
  }
}
```

---

## 2. Tech stack

- **Backend:** Python 3.11+, FastAPI, Pydantic v2, uvicorn. Stream results to the UI over **Server-Sent Events**.
- **Parsing:** PyMuPDF (`pymupdf`) for PDFs. Keep page numbers and detect headings from font size/weight. Use `markdown-it-py` for `.md` files and keep the heading hierarchy.
- **Tokenization:** `tiktoken` (`cl100k_base`) for all token counts. Make the tokenizer itself a swappable component.
- **BM25:** `rank_bm25` (BM25Okapi, with BM25L and BM25Plus as options). Expose `k1` and `b` as parameters.
- **Embeddings:** local by default with `sentence-transformers` (`BAAI/bge-small-en-v1.5`), plus an OpenAI embeddings option. Use numpy cosine similarity for search. FAISS is optional.
- **Rerankers:** use `sentence-transformers` CrossEncoder (`cross-encoder/ms-marco-MiniLM-L-6-v2`, with `BAAI/bge-reranker-base` as an option). Also include an LLM-as-reranker and MMR (diversity).
- **LLM providers:**
  - Ship Anthropic, OpenAI and Ollama (local) providers.
  - Read API keys from `.env`.
  - The model name, temperature and max tokens are set per pane, so I can compare models too.
- **Frontend:**
  - React + Vite + TypeScript, Tailwind CSS and shadcn/ui
  - framer-motion for animation, lucide-react for icons, Zustand for state
  - TanStack Query for server state, `react-resizable-panels` for the split panes
- **Storage:** local disk cache (`./data`) for parsed docs, chunk sets and embeddings. Key every cache entry by a hash of the doc plus the relevant config (details in section 5).
- **Run setup:**
  - One command starts everything: `make dev` or a `dev.sh` that runs the backend and frontend together.
  - Include `README.md`, `.env.example` and a small sample style guide in `samples/` for testing.

---

## 3. The pipeline stages and options

Every stage has an **on/off switch**. When a stage is off, it becomes a passthrough, and the trace shows "skipped".

Turning off retrieval entirely gives a **closed-book baseline**: the LLM answers with no context. This shows what the model "knows" without RAG.

| Stage | Options to implement |
|---|---|
| **Query transform** | none, query rewrite (LLM), multi-query (N rewrites, union of results), HyDE (embed a hypothetical answer), decomposition (split multi-hop question into sub-questions) |
| **Chunking** | fixed-token, recursive character/token (separators hierarchy), sentence-based, markdown/heading-aware (each chunk carries its heading path), semantic chunking (split at embedding-similarity drops), page-based (PDF). Params: `chunk_size_tokens` (64–2048), `overlap_tokens` (0–50% of size), `min_chunk_tokens`, `prepend_heading_path` (bool) |
| **Retrieval** | **BM25 only**, **Semantic (dense) only**, **Hybrid (BM25 + dense)**. Params: `top_k`, per-retriever `candidate_k`, BM25 variant/k1/b, embedding model, similarity threshold |
| **Fusion** (hybrid only) | Reciprocal Rank Fusion (param `k`, default 60), weighted score fusion with **alpha slider** (0 = pure BM25, 1 = pure dense, scores min-max normalized) |
| **Rerank** | none, cross-encoder, LLM reranker, MMR (param `lambda`). Param `rerank_top_n` |
| **Context filter** | score threshold, dedupe near-duplicate chunks, max context tokens budget, merge adjacent chunks, expand to neighbors (±N chunks) |
| **Prompt** | editable prompt template with `{context}` and `{question}`. Options: cite chunk IDs `[C3]`, "answer only from context, else say I don't know" |
| **Generation** | provider, model, temperature, max_tokens, streaming |

---

## 4. UI/UX: the main thing, so make it look excellent

**Visual direction:**

- Modern and polished, like Linear, Vercel or Raycast.
- Dark mode by default, with a light-mode toggle.
- Use generous spacing and one refined accent color. Each pane gets its own subtle identity color: Pane A indigo, Pane B emerald, Pane C amber.
- Animate changes smoothly. Show skeleton loaders while things load.
- Use a monospace font for scores and tokens, and keyboard shortcuts throughout (`⌘↵` to run all).
- It must not look like a default template.

### Layout

```
┌────────────────────────────────────────────────────────────────────────┐
│ Top bar: Doc picker / upload · Stats (pages, tokens, chunks) · Presets │
│          · Panes [1|2|3] · Sync settings toggle · Theme                │
├────────────────────────────────────────────────────────────────────────┤
│ Question bar: big textarea · [Run all ⌘↵] · Auto-run toggle · History  │
├──────────────────────┬──────────────────────┬──────────────────────────┤
│  PANE A  (BM25)      │  PANE B (Semantic)   │  PANE C (Hybrid RRF)     │
│  ┌ Pipeline flow ┐   │                      │                          │
│  │ ●→●→●→○→●→●   │   │  (same structure)    │  (same structure)        │
│  └───────────────┘   │                      │                          │
│  Config drawer       │                      │                          │
│  Answer (streamed)   │                      │                          │
│  Retrieved chunks    │                      │                          │
│  Trace / Prompt tab  │                      │                          │
└──────────────────────┴──────────────────────┴──────────────────────────┘
│ Bottom tabs: Compare · Question Generator · Batch Eval · Document view │
└────────────────────────────────────────────────────────────────────────┘
```

- **Split screen:**
  - Choose **1, 2 or 3 resizable panes**. Default to 3.
  - Default presets: **Pane A = BM25 only, Pane B = Semantic only, Pane C = Hybrid (RRF)**. All three share the same chunking settings so the comparison is fair.
  - Any pane can be maximized, or duplicated into another slot.
- **Pipeline flow strip** (top of each pane):
  - A horizontal node graph of the stages. Each node shows on/off status, the component name, its runtime in ms, and its item count (e.g. "Retrieve · 20 → Rerank · 5").
  - Clicking a node toggles the stage, or opens its config and its trace output.
  - Disabled stages are greyed out with a dashed connector.
  - While a run is in progress, the active node pulses.
- **Config drawer:**
  - Built automatically from the component schemas.
  - Settings that differ from the other panes get a **"≠" badge**, so I can see at a glance what differs between versions.
  - **Sync settings** mode: a changed setting applies to all panes, except locked fields like the retrieval type.
- **Answer card:**
  - Streams in token by token.
  - Citations like `[C3]` are clickable. Clicking one scrolls to and highlights that chunk.
  - Footer shows latency per stage, total tokens in/out, and estimated cost.
- **Retrieved chunks list** (the readable cross-check):
  - Each chunk is a card with:
    - rank and chunk ID
    - **source location** (page number for PDF, heading path for MD)
    - token count
    - full chunk text in clean, readable prose, with **query terms highlighted**
  - Score badges: BM25 score, dense cosine score, fused score, rerank score. Show **rank movement arrows** after reranking (e.g. #7 → #2).
  - Whether the LLM actually cited the chunk.
  - "Show in document" opens the document viewer, scrolled to that chunk with its boundaries and overlap regions shaded.
  - A toggle reveals chunks that were retrieved but dropped (by rerank, threshold or token budget), shown faded, so I can see what was lost.
- **Trace tab:**
  - The full input/output of every stage as collapsible JSON plus a readable view.
  - Includes the **exact final prompt sent to the LLM**, and the rewritten queries or sub-questions if a query transform was on.
- **Compare tab** (cross-pane analysis):
  - Chunk overlap matrix and Venn: which chunks were retrieved by A only, B only, C only, or several panes.
  - Jaccard overlap between the panes' result sets.
  - Answer diff (word-level) between any two panes.
  - Side-by-side metrics table.
- **Document view:**
  - Renders the parsed document with chunk boundaries as colored bands. Hovering a band shows the chunk ID and token count.
  - A chunk-size distribution histogram.
  - Lets me preview how changing chunk size/overlap re-splits the document before running.
- **Auto-run:**
  - When auto-run is on and a question is present, any config change **automatically recomputes** that pane. Debounce by about 600 ms.
  - Each pane can also be re-run on its own.
  - Show an "outdated" indicator when a pane's config has changed since its last run.
- **Run history:** every run is saved locally (question + configs + outputs), so I can reopen and compare past runs.
- **States:** empty, loading, error and missing-API-key states are designed, not afterthoughts. Errors show which stage failed and why.

---

## 5. Performance and caching (so toggling feels instant)

Cache each layer separately, keyed by a hash of only the settings that affect it:

- **parse**: depends on file hash
- **chunks**: depends on parse + chunking params
- **BM25 index / embeddings**: depend on chunks + embedder
- **retrieval / rerank / generation**: always recomputed (cheap or query-dependent)

So changing the reranker or alpha never re-chunks or re-embeds. Changing chunk size re-chunks and re-embeds only once, and that result is then reused by every pane that shares the same settings.

Run the 3 panes concurrently (asyncio). Each pane streams its own SSE events: `stage_start`, `stage_end` (with trace payload), `token`, `done`, `error`.

---

## 6. Question generator (deep dive)

The **Question Generator** tab analyzes the uploaded document and produces a test set covering every important question type. Each generated item includes:

`{ id, category, question, expected_answer, gold_chunk_ids / gold source spans (page/heading + quoted text), difficulty (easy/med/hard), what_it_stresses (e.g. "BM25 exact term", "semantic paraphrase", "multi-hop reasoning"), notes }`

**Categories to generate.** Each has a short explanation shown in the UI, so I learn the technique.

1. **Single-hop factual:** the answer is in one chunk.
2. **Multi-hop:** the answer requires combining 2+ separate sections.
3. **Comparison:** contrast two rules or concepts.
4. **Rule application:** "Rewrite this sentence according to the guide." This is a key type for a style guide.
5. **Exception / edge case:** "When does rule X *not* apply?"
6. **Rule conflict / precedence:** two rules seem to collide; which wins?
7. **Exact-term / keyword lookup:** rare terms, codes or names; stresses **BM25**.
8. **Paraphrased / lexical mismatch:** same meaning, different words from the doc; stresses **semantic search**.
9. **List / aggregation:** "List all rules about X" (spread across sections; tests recall and top_k).
10. **Numerical / specific detail:** limits, counts, formats.
11. **Negation:** "What should you NOT do when…"
12. **Unanswerable / out-of-scope:** the answer is not in the doc. The correct behavior is "I don't know" (tests hallucination).
13. **False premise / adversarial:** the question assumes something the guide doesn't say.
14. **Ambiguous / underspecified:** the model should ask for clarification or cover the interpretations.
15. **Summarization / holistic:** whole-section understanding.
16. **Multi-turn follow-up:** a question that depends on a previous turn (generated as a pair).

**Generator features:**

- Choose categories and the count per category.
- Generate with the LLM, section by section, so coverage is spread across the whole document. Then run a validation pass that checks each gold span really exists in the doc.
- Show results in a filterable, editable table: I can edit, delete or add questions manually.
- Clicking a question **sends it to the question bar** and runs it across all panes.
- Export and import as JSON/CSV.

---

## 7. Batch evaluation

The **Batch Eval** tab runs the whole question set, or a filtered subset, across the 1–3 pane configs. It reports:

- **Retrieval metrics** (against gold chunks/spans; a chunk counts as a hit if it overlaps the gold span): Hit@k, Recall@k, MRR, nDCG@k
- **Answer metrics** via an LLM judge (swappable `Judge` component, rubric shown in the UI):
  - correctness vs expected answer (1–5)
  - faithfulness/groundedness to the retrieved context
  - citation accuracy
  - correct abstention on unanswerable questions
- **Ops:** latency p50/p95, tokens, cost.

**Views:**

- Leaderboard of configs.
- A per-category breakdown chart showing *which question types each retrieval strategy fails on*. This is the key insight view: BM25 vs semantic vs hybrid by category.
- A per-question drill-down that opens the full 3-pane trace for that question.
- Export the results as CSV/JSON.

---

## 8. API sketch (adjust as needed)

```
POST /api/documents            (upload .md/.pdf) → doc_id, stats
GET  /api/documents/{id}       parsed structure
POST /api/chunk/preview        doc_id + chunking config → chunks + stats
GET  /api/components           registry + JSON schemas
POST /api/run                  { doc_id, question, pipelines[] } → SSE stream (per-pane events)
POST /api/questions/generate   { doc_id, categories, counts } → question set
POST /api/eval                 { doc_id, question_set, pipelines[] } → SSE progress + results
GET/POST /api/presets, /api/history
```

---

## 9. Suggested project structure

```
rag-lab/
  backend/
    app/main.py, api/, core/
    core/registry.py          # @register, schema export
    core/pipeline.py          # orchestrator, tracing, passthrough on disabled stages
    core/cache.py
    components/
      parsers/  chunkers/  embedders/  retrievers/  fusion/
      rerankers/  query_transforms/  context_filters/  prompts/  llms/  judges/
    qgen/                     # question generation + validation
    eval/                     # metrics + batch runner
    tests/
  frontend/
    src/components/ (panes, flow strip, schema-form, chunk cards, compare, qgen, eval)
    src/store/  src/api/  src/lib/
  samples/style_guide_sample.md
  Makefile, README.md, .env.example
```

---

## 10. Milestones (build and verify each one in order)

1. **Skeleton:** backend + frontend running together. Registry and auto-generated config forms working with one dummy component.
2. **Ingestion:** MD/PDF parsing, all chunkers, document view with chunk bands, chunk preview.
3. **Retrieval:** BM25, dense, hybrid (RRF + alpha), caching, retrieved-chunk cards with scores and highlighting.
4. **Full pipeline:** rerankers, query transforms, context filters, prompt, LLM streaming, the per-stage on/off passthrough, and the trace tab.
5. **3-pane split screen:** parallel runs, flow strip, ≠ diff badges, sync mode, auto-run, compare tab.
6. **Question generator.**
7. **Batch eval** + leaderboard + per-category chart.
8. **Polish:** animations, empty/error states, keyboard shortcuts, history, presets, README.

## 11. Acceptance criteria

- I upload a PDF, type a question, press ⌘↵, and see 3 streamed answers side by side (BM25 / Semantic / Hybrid). Each shows the readable chunks it used, along with their scores and source locations.
- Changing chunk size, overlap, strategy, retrieval type, alpha, top_k or reranker re-runs the affected pane automatically, and settings that differ between panes are flagged.
- Turning off any stage shows the passthrough in the flow strip. Turning off retrieval gives a no-context baseline.
- Clicking a citation highlights the exact chunk. "Show in document" shows where it sits in the original.
- Adding a new chunker in one new file makes it appear in the UI with its parameters, with no frontend changes.
- The question generator produces all 16 categories with gold spans. Batch eval shows which retrieval strategy wins per category.
- Backend has unit tests for chunkers (size/overlap correctness), BM25/dense/fusion ranking, and the metrics. `make test` passes.
- No hardcoded API keys. The app runs fully locally, with Ollama + local embeddings, when no cloud keys are set.

Make reasonable decisions where this spec is silent, and record them in `PLAN.md`. Prioritize a working end-to-end flow first, then depth, then polish.
