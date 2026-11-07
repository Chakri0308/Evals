# RAG Lab: complete rebuild specification

This document specifies **RAG Lab** completely enough that a coding agent can rebuild it from an empty folder with
the same behaviour, structure, look and test results. Read all of it before writing code. Where this document gives
an exact string, number, name or formula, use it exactly. Where it says MUST, it is a requirement.

---------------------------------------------------------------------------------------------------------------------

## 0. How to use this document

**Build order** (each step must pass its checks before the next):

1. Repository skeleton, config and backend tooling (§3, §4, §24).
2. Backend core: types, cache, registry, capability layer, local models (§5–§9) and storage (§16).
3. Backend components: parsers, tokenizers, chunkers, embedders, LLMs, retrievers, fusers, rerankers, query transforms,
   context filter, prompt, judges, vector stores (§10).
4. Vector-store layer, readiness report, providers, default panes, pipeline orchestrator (§11–§15).
5. Question generation, question analysis, evaluation (§17–§19).
6. API routers, app factory, startup (§20–§21).
7. Backend tests (§26). All of them MUST pass.
8. Frontend: architecture, stores, components, theme (§22–§23).
9. Run scripts, Makefile, Dockerfile (§25), then the acceptance checklist (§27). Read the pitfalls (§28) before
   debugging anything.

**Rules for the implementing agent**

* Do not invent features, rename things, or "improve" algorithms. Reproduce what is specified.
* Python 3.11, FastAPI, Pydantic v2. Frontend: React 19, Vite 8, TypeScript, Tailwind CSS **v3**.
* Every user-visible string quoted in this document MUST be used verbatim (see also Appendix A).
* Never hardcode API keys. Keys and connection strings are read only from environment variables (`.env`).
* All file writes go under the data directory (`RAG_LAB_DATA`, default `rag-lab/data`), never elsewhere.
* On Windows, always open text files with `encoding="utf-8"` (the default code page cannot write `⚙`, `·`, `→`, etc.).
* The frontend type-check MUST be run as `tsc --noEmit -p tsconfig.app.json`. The root `tsconfig.json` only holds
  project references (`"files": []`), so `tsc -p .` silently checks nothing.

---------------------------------------------------------------------------------------------------------------------

## 1. What RAG Lab is

RAG Lab is a local web app for comparing Retrieval-Augmented Generation (RAG) pipelines on a **style-guide document**
(Markdown or PDF). The user uploads a guide (a sample guide is preloaded) and asks a question. **Up to three panes**
(A, B, C) run independently configured pipelines on the same question in parallel and stream their answers with
clickable citations (`[C3]`). The user can inspect every stage, switch any stage off, compare answers side by side,
generate a 16-category test-question set, see why each question is a good test of BM25 or semantic search, and
batch-evaluate the configurations.

Key properties:

* **Pluggable everything.** Every pipeline stage is a registered component in its own file. Each component declares a
  Pydantic `Params` model, and the UI renders its config form from that model's JSON Schema. Adding a component means
  adding one file, with no UI changes.
* **Swappable providers.** LLMs: Ollama (default), Anthropic Claude, OpenAI, Google Gemini, Azure OpenAI, any
  OpenAI-compatible server, plus an extractive no-LLM answerer. Vector DBs: Chroma (default), FAISS, pgvector, Pinecone,
  in-memory. Embeddings: local sentence-transformers (default `BAAI/bge-small-en-v1.5`), Ollama, OpenAI, Gemini.
* **Office / no-LLM mode.** Policy switches can forbid all LLM calls and/or all embedding/reranker model use (locked
  from `.env`). Then BM25 still answers extractively (quoting sentences with citations), semantic and hybrid panes show
  a "pre-flight" readiness report with a light-hearted message instead of an error, and every other LLM-dependent
  feature falls back automatically.
* **Citi-inspired visual theme** (brand blue `#255be3`, navy `#0f1632`), without Citi logos or proprietary fonts.
* **Production mode:** one process serves the built UI and the API on one port.

Default panes: **A = BM25**, **B = Semantic** (dense + cross-encoder rerank), **C = Hybrid RRF**.

---------------------------------------------------------------------------------------------------------------------

## 2. Technology and versions

Versions used for the reference build (use these or newer compatible ones):

**Backend (Python 3.11):** fastapi 0.162.0, uvicorn[standard] 0.54.0, pydantic 2.14.2, python-multipart 0.0.33,
python-dotenv 1.2.4, pymupdf 2.1, markdown-it-py 4.2.0, tiktoken 0.14.0, rank-bm25 0.2.2, **numpy 1.26.4 (MUST be
`<2`)**, httpx 0.28.1, anthropic 2.5.0, openai 3.46.0, sentence-transformers 6.2.0, transformers 5.22.1,
torch 2.15.0+cpu (installed from `https://download.pytorch.org/whl/cpu`), chromadb 1.5.9.
Optional: faiss-cpu 1.15.1, psycopg[binary] 3.3.8, pinecone 10.3.0. Dev: pytest 9.2.0, ruff 0.17.4, vulture.

**Frontend (Node 18+; reference Node 24):** react 19.3, react-dom 19.3, vite 8.3 (rolldown), @vitejs/plugin-react 6,
typescript ~7.0, tailwindcss 3.4 (NOT v4), @tailwindcss/container-queries 0.1.1, autoprefixer, postcss, oxlint 1.89,
zustand 5 (with `persist`), @tanstack/react-query 5, framer-motion 14, lucide-react 1.68,
react-resizable-panels **4.x** (API: `Group`, `Panel`, `Separator`; prop `orientation`; sizes are percentage
**strings**, e.g. `defaultSize="60"`), Radix primitives (react-dialog, popover, select, slider, slot, switch, tabs,
tooltip), class-variance-authority, clsx, tailwind-merge.

**Local LLM:** Ollama with model `qwen2.5:1.5b` (`ollama pull qwen2.5:1.5b`), API at `http://127.0.0.1:11434`.

**Ports:** API **8765** (port 8000 was taken on the reference machine), Vite dev UI **5173**.

---------------------------------------------------------------------------------------------------------------------

## 3. Repository layout (exact)

```
rag-lab/
  .env.example            .gitignore            .dockerignore        Dockerfile
  Makefile                dev.ps1   dev.sh      prod.ps1   prod.sh   README.md   PLAN.md
  scripts/common.ps1      scripts/common.sh
  samples/style_guide_sample.md                 (verbatim in Appendix B)
  data/                   (runtime, git-ignored; created automatically)
  backend/
    pyproject.toml  requirements.txt  requirements-dev.txt  requirements-optional.txt
    app/
      __init__.py
      main.py             config.py             startup.py
      api/      __init__.py deps.py meta.py documents.py runs.py questions.py evals.py
      core/     __init__.py types.py cache.py registry.py interfaces.py documents.py indexes.py pipeline.py
                settings.py capability.py models.py embeddings.py providers.py vectorstore.py readiness.py
                storage.py defaults.py
      components/__init__.py
        parsers/       __init__.py markdown_parser.py pdf_parser.py
        tokenizers/    __init__.py tiktoken_tok.py whitespace_tok.py
        chunkers/      __init__.py _base.py fixed_token.py recursive.py sentence.py markdown_heading.py
                       semantic.py page.py
        embedders/     __init__.py _base.py sentence_transformers_emb.py openai_emb.py ollama_emb.py gemini_emb.py
        retrievers/    __init__.py _common.py bm25.py dense.py hybrid.py
        fusion/        __init__.py rrf.py weighted.py          (merge_hit + minmax helpers live in rrf.py / weighted.py)
        rerankers/     __init__.py cross_encoder.py llm_reranker.py mmr.py   (NoRerank "none" is in cross_encoder.py)
        query_transforms/ __init__.py _util.py transforms.py
        context_filters/  __init__.py standard.py
        prompts/       __init__.py template.py
        llms/          __init__.py _base.py ollama_llm.py anthropic_llm.py openai_llm.py gemini_llm.py extractive.py
        judges/        __init__.py heuristic.py llm_judge.py
        vector_stores/ __init__.py _base.py in_memory.py chroma_store.py faiss_store.py pgvector_store.py
                       pinecone_store.py
      qgen/      __init__.py categories.py generator.py analysis.py
      evaluation/ __init__.py metrics.py runner.py
    tests/  __init__.py conftest.py helpers.py test_api.py test_ingestion.py test_retrieval.py
            test_vector_stores.py test_policy_and_fallbacks.py test_evaluation.py
  frontend/
    index.html  package.json  vite.config.ts  tailwind.config.js  postcss.config.js
    tsconfig.json  tsconfig.app.json  tsconfig.node.json
    src/ main.tsx App.tsx index.css
      api/   client.ts hooks.ts
      store/ app.ts qset.ts
      lib/   types.ts utils.ts diff.ts highlight.tsx questionAnalysis.ts
      components/ TopBar.tsx QuestionBar.tsx SettingsDialog.tsx
        ui/index.tsx  schema/SchemaForm.tsx schema/DiffBadge.tsx  common/JsonView.tsx common/LlmPicker.tsx
        panes/ PaneArea.tsx Pane.tsx FlowStrip.tsx ConfigDrawer.tsx AnswerCard.tsx ChunkCard.tsx TraceView.tsx
               ReadinessCard.tsx
        bottom/ CompareTab.tsx QGenTab.tsx QInsights.tsx EvalTab.tsx DocumentView.tsx
```

`.gitignore`: `.env`, `data/`, `backend/.venv/`, `**/__pycache__/`, `frontend/node_modules/`, `frontend/dist/`,
`.pytest_cache/`.

---------------------------------------------------------------------------------------------------------------------

## 4. Configuration

### 4.1 Process configuration: `app/config.py`

Loaded once at import. `ROOT = Path(__file__).resolve().parents[2]` (the `rag-lab/` folder).
`load_dotenv(ROOT / ".env")` runs at import, before anything reads the environment.

| Name | Source | Default |
|---|---|---|
| `DATA_DIR` | `RAG_LAB_DATA` (empty string = default) | `ROOT/data` |
| `DATA_SUBDIRS` | constant | `docs uploads chunks emb presets history qsets evals` |
| `SAMPLE_DOC` | constant | `ROOT/samples/style_guide_sample.md` |
| `FRONTEND_DIST` | `RAG_LAB_FRONTEND_DIST` | `ROOT/frontend/dist` |
| `CORS_ORIGINS` | `RAG_LAB_CORS_ORIGINS`, comma-separated | `http://127.0.0.1:5173,http://localhost:5173` |
| `LOG_LEVEL` | `RAG_LAB_LOG_LEVEL` | `INFO` |
| `WARMUP` | `RAG_LAB_WARMUP` (`0,false,no,off` = off) | true |

`ensure_data_dirs()` creates every subdirectory. It is called at import of `config.py`. `setup_logging()` calls
`logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s", datefmt="%H:%M:%S")`.
`core/cache.py` re-exports `DATA_DIR` from `app.config` (most modules import it from `app.core.cache`).

### 4.2 Runtime settings and access policy: `app/core/settings.py`

Settings dict keys and built-in defaults:

```python
BUILTIN = {"llm_provider": "ollama", "llm_model": "", "embedding_model": "local:BAAI/bge-small-en-v1.5",
           "vector_store": "chroma", "allow_llm": True, "allow_embeddings": True}
ENV_MAP = {"llm_provider": "LLM_PROVIDER", "llm_model": "LLM_MODEL", "embedding_model": "EMBEDDING_MODEL",
           "vector_store": "VECTOR_STORE", "allow_llm": "RAG_LAB_ALLOW_LLM", "allow_embeddings": "RAG_LAB_ALLOW_EMBEDDINGS"}
```

* Truthiness: a string is false if, after strip and lowercase, it is one of `0, false, no, off, ""`.
* `offline()` = truthy(`RAG_LAB_OFFLINE`, default "false").
* `locks()` returns `{key: reason}` for policy switches forced off by the environment:
  * if offline: both `allow_llm` and `allow_embeddings` → `"RAG_LAB_OFFLINE=true in .env"`;
  * for each of `allow_llm` / `allow_embeddings`: if its env var is set, non-empty and falsy →
    `"<ENVVAR>=false in .env"`.
* `get()`: start with BUILTIN, overlay non-empty env vars (`allow_*` parsed as booleans), overlay keys from
  `DATA_DIR/settings.json` (only keys in BUILTIN), then force every locked key to False. **Read on every call**, with no
  caching, so tests can monkeypatch the environment.
* `update(changes)`: unknown keys → `ValueError("Unknown setting(s): [...]")`. Setting a locked key to a truthy value →
  `PermissionError("'<key>' is locked off by <reason>")`. Otherwise merge into `settings.json` under a lock and write
  it (indent 2). Return `get()`.
* `llm_allowed()` / `embeddings_allowed()` return the respective setting.
* `apply_process_env()`: if offline, `setdefault` `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1`.
* `class Unavailable(Exception)`: `__init__(self, reason, *, what="", fix="")`, storing `.reason`, `.what` and `.fix`. It
  means "this capability cannot run here", and the pipeline turns it into a fallback, never a crash.
* Constants: `POLICY_LLM = "LLM calls are switched off (no-LLM mode)"`,
  `POLICY_EMB = "Embedding/reranker models are switched off"`.

### 4.3 `.env.example` (exact keys, with the comments shown)

```
# RAG Lab configuration. Copy to .env (never commit .env). Everything is optional:
# with no keys at all the app runs locally (Ollama + local embeddings + Chroma).
# Most of these can also be changed live in the UI (gear icon); .env sets the starting defaults.

# access policy (office / locked-down machines)
RAG_LAB_ALLOW_LLM=true          # false = never call any LLM; BM25 answers by quoting sentences
RAG_LAB_ALLOW_EMBEDDINGS=true   # false = never load/call embedding or reranker models
RAG_LAB_OFFLINE=false           # true = both of the above + no model downloads
# A switch set to false here is LOCKED: the UI shows it but cannot turn it back on.

# defaults
LLM_PROVIDER=ollama             # ollama | anthropic | openai | gemini | azure_openai | openai_compatible | extractive
LLM_MODEL=                      # "" = the provider's own default
EMBEDDING_MODEL=local:BAAI/bge-small-en-v1.5   # provider:model, providers local|ollama|openai|gemini
VECTOR_STORE=chroma             # chroma | faiss | pgvector | pinecone | in_memory

# LLM providers
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:1.5b
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=                 # GOOGLE_API_KEY also accepted
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_API_VERSION=2024-10-21
AZURE_OPENAI_DEPLOYMENT=
OPENAI_COMPATIBLE_BASE_URL=     # e.g. https://api.groq.com/openai/v1
OPENAI_COMPATIBLE_API_KEY=
OPENAI_COMPATIBLE_MODEL=
OPENAI_EMBEDDINGS_BASE_URL=
LLM_PRICES=                     # JSON {"model": [usd_per_1M_in, usd_per_1M_out]}

# vector databases
CHROMA_HOST=
CHROMA_PORT=8000
FAISS_INDEX=flat                # flat | hnsw
PGVECTOR_DSN=
PINECONE_API_KEY=
PINECONE_INDEX=rag-lab
PINECONE_CLOUD=aws
PINECONE_REGION=us-east-1

# server / deployment
RAG_LAB_DATA=
RAG_LAB_HOST=127.0.0.1          # read by prod.ps1 / prod.sh from the shell environment
RAG_LAB_PORT=8765
RAG_LAB_CORS_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
RAG_LAB_LOG_LEVEL=INFO
RAG_LAB_WARMUP=true
```

(In the real file, put each comment on its own line above its key, as in a normal dotenv file. Inline comments are
shown here only for brevity.) Also read: `CHROMA_PATH`, `FAISS_PATH`, `DATABASE_URL` (pgvector fallback),
`PINECONE_HOST` (Pinecone Local), `RAG_LAB_FRONTEND_DIST`.

---------------------------------------------------------------------------------------------------------------------

## 5. Data model: `app/core/types.py` (Pydantic v2)

```python
class Block(BaseModel):   kind: str  # heading|paragraph|list|code|table|quote|other
                          start: int; end: int  # char offsets into Document.text, [start, end)
                          page: Optional[int] = None; level: int = 0; heading_path: list[str] = []
class Document(BaseModel): id: str; name: str; kind: str  # md|pdf|txt
                          text: str; blocks: list[Block]; pages: int = 0; meta: dict[str, Any] = {}
    def location(self, start) -> (page, heading_path):
        # first block with b.start <= start < max(b.end, b.start+1); else the last block with b.start <= start;
        # else (None, [])
class Chunk(BaseModel):   id: str  # "C1", "C2"... (1-based)
                          index: int  # 0-based
                          start: int; end: int; text: str
                          index_text: str  # text that is indexed/embedded (heading path prepended if enabled)
                          tokens: int; page: Optional[int] = None; heading_path: list[str] = []
class ChunkSet(BaseModel): key: str; doc_id: str; chunks: list[Chunk]
    def by_id(self) -> dict[str, Chunk]
class Hit(BaseModel):     chunk_id: str; scores: dict[str, float] = {}  # keys bm25|dense|fused|rerank
                          ranks: dict[str, int] = {}  # 1-based; keys bm25|dense|fused|rerank|retrieval|final
                          dropped_by: Optional[str] = None; drop_reason: Optional[str] = None
class QueryBundle(BaseModel): original: str; queries: list[str]  # lexical (BM25)
                          dense_queries: list[str]  # embedded (HyDE replaces these); notes: dict = {}
class RetrievalOutput(BaseModel): lists: dict[str, list[Hit]]  # "bm25" and/or "dense"
class Usage(BaseModel):   input_tokens: int = 0; output_tokens: int = 0; cost_usd: float = 0.0
```

`app/core/interfaces.py` holds `typing.Protocol` definitions (Parser, Tokenizer, Chunker, Embedder, Retriever, Fuser,
Reranker, QueryTransform, ContextFilter, PromptBuilder, LLM with `ready()`, Judge) and the per-run context:

```python
class Ctx:
    def __init__(self, doc, tokenizer, llm_factory=None, trace=None):
        self.doc = doc; self.tokenizer = tokenizer
        self.llm_factory = llm_factory   # () -> the pane's generation LLM
        self.trace = trace if trace is not None else {}
```

---------------------------------------------------------------------------------------------------------------------

## 6. Hashing and caching: `app/core/cache.py`

* `stable_hash(*parts, n=16)`: SHA-256. For each part: bytes are hashed raw, anything else as
  `json.dumps(p, sort_keys=True, default=str).encode()`. Append `b"|"` after each part. Return the first `n` hex chars.
* `MemoryLRU(maxsize)`: thread-safe, insertion-ordered dict with move-to-end on get. The global `_mem = MemoryLRU(128)`.
* Per-key locks (`_lock_for(key)`) prevent duplicate computation.
* `cached_json(layer, key, compute, dump, load) -> (value, hit)`: memory → `DATA_DIR/layer/key.json` → compute and
  persist.
* `cached_array(layer, key, compute) -> (ndarray, hit)`: memory → `DATA_DIR/layer/key.npy` → compute and `np.save`.
* `cached_memory(layer, key, compute) -> (value, hit)`: memory only.

Cache keys:
* document id = `stable_hash(file_bytes)`;
* chunk set = `stable_hash(doc.id, tokenizer, chunker, validated_params(by_alias), chunker_class.version or 1)`;
* embeddings = `stable_hash(chunkset.key, embedder.cache_id())`;
* BM25 index (memory only) = `stable_hash(cs.key, variant, k1, b, remove_stopwords)`.

---------------------------------------------------------------------------------------------------------------------

## 7. Component registry: `app/core/registry.py`

```python
KINDS = ["parser", "tokenizer", "chunker", "embedder", "retriever", "fuser", "reranker",
         "query_transform", "context_filter", "prompt", "llm", "judge", "vector_store"]
STAGE_TO_KIND = {"query_transform": "query_transform", "chunking": "chunker", "retrieval": "retriever",
                 "fusion": "fuser", "rerank": "reranker", "context_filter": "context_filter",
                 "prompt": "prompt", "generation": "llm"}
```

* `@register(kind, name, *, label=None, order=100)`: stores a `ComponentSpec(kind, name, cls, params_model, label,
  description, order)`. `params_model = cls.Params` or an empty `NoParams` model. `description` = the first paragraph of
  the class docstring with newlines replaced by spaces. Sets `cls.component_name = name`. The default label is
  `name.replace("_"," ").title()`. An unknown kind raises ValueError.
* `ComponentSpec.schema()` = `params_model.model_json_schema()`.
* `get_spec(kind, name)` raises `KeyError(f"No {kind} component named '{name}'. Available: [...]") from None`.
* `create(kind, name, params=None)` instantiates `spec.cls(spec.params_model(**params))`.
* `validate_params(kind, name, params)` returns the validated model.
* `all_specs()` returns `{kind: [specs sorted by (order, name)]}`.
* `discover()` (idempotent) imports every module under `app.components` with `pkgutil.walk_packages`.
* `class Component`: `Params = NoParams`; `__init__(self, params)` stores `self.p = params`.
* JSON-schema extensions used by the UI: `x-suggest` (free text with suggestion list), `x-options` (dropdown fed from
  a suggestion list), `x-widget: "textarea"`, `examples` (suggestions).

---------------------------------------------------------------------------------------------------------------------

## 8. Capability layer: `app/core/capability.py`

```python
POLICY = {"llm": (settings.llm_allowed, settings.POLICY_LLM),
          "embeddings": (settings.embeddings_allowed, settings.POLICY_EMB)}
```

* `guard_methods(cls, names, kind, applies=lambda self: True)`: for each name defined **in `cls.__dict__`**, replace it
  with a wrapper that, when `applies(self)` is true and the policy forbids `kind`, raises
  `Unavailable(<policy message>, what=kind)` **before** calling the original. It MUST support sync functions, coroutine
  functions and async-generator functions (use `inspect.isasyncgenfunction` / `iscoroutinefunction`, `functools.wraps`).
* `class Capability` (mixin): `policy_kind = "llm"`, `uses_policy() -> True`, `available() -> (True, "")`, and
  `ready()`: if `uses_policy()` and the policy forbids `policy_kind`, return `(False, policy_message)`; otherwise return
  `available()`, catching exceptions as `(False, "<ExcType>: <msg>")`.
* `require_env(*names, example="", hint="Add it to .env, or pick another provider.")`: returns `(True, "")` if all are
  set, else `(False, "<A> is not set[ (e.g. <example>)]. <hint>")`, or for several missing variables
  `"<A> and <B> are not set. <hint>"`.

## 9. Local models: `app/core/models.py`

* `load(kind, name)`: process-wide cache keyed `(kind, name)` under a lock. `kind == "cross_encoder"` →
  `sentence_transformers.CrossEncoder(name, device="cpu")`, else `SentenceTransformer(name, device="cpu")`. Logs
  "loading %s model %s".
* `is_loaded(kind, name)`.
* `status(name) -> (ok, detail)`:
  * a local directory → `(True, "local folder <name>")`;
  * `huggingface_hub.try_to_load_from_cache(name, "config.json")` returns a str → `(True, "cached locally")`;
  * if offline (settings.offline() or `HF_HUB_OFFLINE=="1"`) → `(False, "model '<name>' is not downloaded and offline
    mode forbids downloads. Copy the model folder onto this machine and use its path as the model name.")`;
  * else `httpx.head("https://huggingface.co", timeout=3, follow_redirects=True)` succeeds →
    `(True, "not cached yet; downloads on first use")`;
  * on failure → `(False, "model '<name>' is not downloaded and huggingface.co is unreachable. Copy the model folder onto
    this machine and use its path as the model name.")`.

---------------------------------------------------------------------------------------------------------------------

## 10. Component catalogue (exact names, labels, order, params, defaults)

All params are Pydantic fields with the given defaults and bounds (`ge`/`le`). The description texts are shown in the
UI as tooltips; copy them exactly.

### 10.1 parser
| name | label | order | params |
|---|---|---|---|
| `markdown` | Markdown (markdown-it) | 1 | none. `extensions = (".md", ".markdown", ".txt")` |
| `pymupdf` | PDF (PyMuPDF) | 2 | `heading_size_ratio: float = 1.15 [1.0, 2.0]` "Font size / body size to count as heading". `extensions = (".pdf",)` |

**Markdown parser.** Decode UTF-8 (`errors="replace"`) and normalise `\r\n` and `\r` to `\n`. `Document.text` is the
normalised source (offsets map 1:1). Parse with `MarkdownIt("commonmark").enable("table")`. Walk the tokens:
* `heading_open` with a map: `level = int(tag[1])`, title = next inline token content stripped. Pop the path while
  last level ≥ level, then push. Add `Block(kind="heading", start=line_offset(map[0]), end=line_offset(map[1]) - 1,
  level, heading_path=titles)`, and skip 3 tokens.
* Other tokens with a map, `nesting >= 0` and `level == 0`: kind from `paragraph_open→paragraph`,
  `bullet_list_open/ordered_list_open→list`, `fence/code_block→code`, `table_open→table`, `blockquote_open→quote`,
  `hr/html_block→other`, else `other`. Span = `[off(map0), max(s, off(map1)-1))`. Add only if the text is non-blank,
  with the current heading path.
* Sort blocks by start. `kind="md"`, `pages=0`.

**PDF parser.** PyMuPDF `page.get_text("dict")`, text blocks only. Per block: join span texts per line, collect the
font sizes, count characters (stripped) per size into a Counter, and count bold characters (flag `& 16` or "bold" in the
font name). `txt` = the non-empty stripped lines joined with spaces. Record `(page, txt, max line size,
bold_ratio > 0.8)`. Body size = most common size (default 10). Heading sizes = sorted desc, unique rounded sizes
≥ `body * ratio`. A block is a heading if `len(txt) < 120 and (size >= body*ratio or (bold and len(txt) < 80 and not
txt.endswith(".")))`. Level = index in heading_sizes + 1 (capped at 6), or `len(heading_sizes)+1` for bold-only
headings. The document text is the blocks joined with `"\n\n"` (each block followed by `\n\n`). Blocks carry `page`.
`kind="pdf"`, `pages=len(pdf)`.

### 10.2 tokenizer
| name | label | order | params |
|---|---|---|---|
| `tiktoken` | tiktoken | 1 | `encoding: Literal["cl100k_base","o200k_base"] = "cl100k_base"` "BPE encoding" |
| `whitespace` | Whitespace | 5 | none |

Interface: `encode(text) -> list[int]`, `count(text) -> int`, `offsets(text) -> list[(start, end)]`.
* tiktoken: cache encodings per name. `encode(text, disallowed_special=())`. Offsets come from
  `enc.decode_with_offsets(tokens)`: token i spans `[starts[i], starts[i+1])`, the last token ends at `len(text)`, and
  `end = max(end, start)`.
* whitespace: regex `\S+`. `encode` = `hash(word) & 0xFFFFFFF`.

### 10.3 chunker (all share `ChunkParams`)
```python
class ChunkParams(BaseModel):
    chunk_size_tokens: int = Field(256, ge=64, le=2048, description="Maximum tokens per chunk")
    overlap_tokens: int = Field(32, ge=0, le=1024, description="Tokens shared with the previous chunk (≤ 50% of size)")
    min_chunk_tokens: int = Field(16, ge=0, le=512, description="Chunks smaller than this merge into the previous one")
    prepend_heading_path: bool = Field(True, description="Prefix the heading path to the indexed/embedded text")
    @model_validator(mode="after")   # cap overlap at 50%: overlap_tokens = min(overlap_tokens, chunk_size_tokens // 2)
```
| name | label | order | extra params |
|---|---|---|---|
| `fixed_token` | Fixed token | 1 | none |
| `recursive` | Recursive | 2 | `separators: str = "\\n\\n\|\\n\|. \|, \| "` "Separator hierarchy, '\|' separated (\n = newline)" |
| `sentence` | Sentence | 3 | none |
| `heading_aware` | Heading-aware | 4 | none. **class attribute `version = 2`** |
| `semantic` | Semantic | 5 | `breakpoint_percentile: int = 20 [1, 60]`, `embedder: str = "sentence_transformers"` |
| `page` | Page-based | 6 | none |

Descriptions (docstrings):
* fixed_token: "Slides a fixed-size token window with overlap. Ignores structure entirely."
* recursive: "Splits on a separator hierarchy (paragraph, line, sentence, word), then packs the pieces up to the size."
* sentence: "Packs whole sentences (and list items) into chunks. Never cuts mid-sentence unless a sentence is too long."
* heading_aware: "Chunks within each heading section and never crosses a section boundary. Each chunk carries its
  heading path."
* semantic: "Embeds each sentence and splits where the similarity between neighbouring sentences drops."
* page: "One chunk per PDF page; pages larger than the size are split recursively. Markdown files fall back to
  sections."

Helpers in `chunkers/_base.py`. `Span = tuple[int, int]`, all `[start, end)` over `doc.text`.
* `strip_span(text, s, e)`: move s forward and e backward past whitespace.
* `split_by_sep(text, s, e, sep)`: split on sep, **keeping the separator attached to the preceding piece**, and drop
  empty pieces.
* `_SENT = re.compile(r"(?<=[.!?:;])[\"')\]]*\s+(?=[\"'(\[*\-•]?[A-Z0-9`])")`.
  `sentence_spans(text, s, e)`: split by `"\n"` into lines, strip each line, then cut each line at `_SENT` matches
  (piece = `[cur, m.start())`, then `cur = m.end()`).
* `token_windows(text, s, e, tok, size, overlap=0)`: windows of `size` tokens over `tok.offsets(text[s:e])` with
  step `max(1, size - overlap)`, mapped back to char spans. Stop after the window that reaches the end.
* `recursive_split(text, s, e, tok, size, seps)`: if it fits (≤ size tokens), return `[(s, e)]`. If no separators
  remain, fall back to `token_windows`. Otherwise split by `seps[0]` and recurse with `seps[1:]`.
* `pack(text, spans, tok, size, overlap)`: greedy. Start a chunk at span i and extend while
  `tok.count(text[cs:spans[i][1]]) <= size`, then emit `(cs, ce)`. For overlap, if more spans remain and overlap > 0,
  back up j from i while `j-1 > start_idx` and `tok.count(text[spans[j-1][0]:ce]) <= overlap`. Then, **only if
  `j < i` and `tok.count(text[spans[j][0]:spans[i][1]]) <= size`**, set `i = j`.
* `merge_small(text, spans, tok, min_tokens)`: if min_tokens ≤ 0 or there are fewer than 2 spans, return unchanged.
  Append each span to the previous one if its token count is < min_tokens. Finally, if the first output span is
  < min_tokens and there is more than one, merge it into the second.
* `sections(doc)`: section starts = sorted({0} ∪ heading block starts). Each section runs to the next start; keep
  non-blank sections.
* `finalize(doc, spans, tok, prepend, heading_override=None)`: strip each span, skip empty ones,
  `page, hp = doc.location(s)`, `body = text[s:e]`,
  `index_text = " > ".join(hp) + "\n" + body if prepend and hp else body`, `tokens = tok.count(body)`. Ids are assigned
  after filtering: `index = i`, `id = f"C{i+1}"`.

Algorithms:
* **fixed_token**: `token_windows(0, len, size, overlap)`, then `merge_small` if more than one, then finalize.
* **recursive**: `seps = [s.replace("\\n", "\n") for s in separators.split("|") if s]`, then recursive_split →
  pack → merge_small → finalize.
* **sentence**: sentence_spans (a sentence longer than size is replaced by its token_windows), then pack →
  merge_small → finalize.
* **heading_aware**: `seps = ["\n\n", "\n", ". ", " "]`. Fold small sections first: iterate `sections(doc)`. If a carry
  start exists, the section starts at the carry. If the section's token count is `< max(min_chunk_tokens, 1)`, set
  `carry = section start` and skip it. After the loop, a leftover carry extends the last kept section to the document
  end (or becomes the only section). Then per section: recursive_split → pack → merge_small, concatenating all spans,
  then finalize. (This prevents heading-only chunks such as a bare "## 1. Voice and tone".)
* **semantic**: sentence spans (oversized → token_windows). If 1 or fewer, finalize. Create the embedder `p.embedder`
  with `{}`. **If `emb.ready()` is false, raise `Unavailable(f"semantic chunking needs embeddings: {why}",
  what="embeddings")`.** `sims[i] = dot(v[i], v[i+1])`, `thr = percentile(sims, breakpoint_percentile)`. Iterate
  sentences from 1: `too_big = count(text[cs:e]) > size`. If `(sims[i-1] < thr or too_big) and (too_big or
  count(text[cs:ce]) >= min_chunk_tokens)`, emit `(cs, ce)` and set `cs = s`. Always set `ce = e`. Emit the final
  `(cs, ce)`.
* **page**: if `doc.kind == "pdf"` and any block has a page, group blocks by page (`itertools.groupby` on `b.page`) into
  `(first.start, last.end)`; otherwise use `sections(doc)`. A group that fits becomes one span; otherwise
  recursive_split with `["\n\n", "\n", ". ", " "]` + pack. Then finalize (no merge_small).

`core/documents.py`:
* `parse_upload(data, filename) -> (doc, existed)`: `doc_id = stable_hash(data)`. If already loaded, return it with
  True. Pick the first parser (in registry order) whose `extensions` contain the lowercase suffix, else
  `ValueError("Unsupported file type '<ext>'. Upload .md or .pdf")`. Parse, set `meta["tokens"]` (tiktoken count of the
  whole text) and `meta["sections"]` (number of heading blocks). Write `uploads/<id><ext>` and `docs/<id>.json`. Cache
  in memory.
* `load_doc(id)`: memory, then `docs/<id>.json`, else None.
* `list_docs()`: newest first by mtime, as `doc_stats` dicts, skipping corrupt files.
* `doc_stats(doc)` = `{id, name, kind, pages, tokens, sections, chars}`.
* `get_chunkset(doc, component, params, enabled=True, tokenizer="tiktoken") -> (ChunkSet, cache_hit)`. If **not
  enabled**, return one chunk `C1` covering the whole document (key `stable_hash(doc.id, tokenizer, "__whole__")`,
  `page=1 if doc.pages else None`, `heading_path=[]`, hit=True). Otherwise validate the params, compute the key (§6), and
  use `cached_json("chunks", ...)` to create the chunker and call `chunk(doc, Ctx(doc, tok))`.

### 10.4 embedder (base `BaseEmbedder(Capability, Component)`, `policy_kind="embeddings"`)
`__init_subclass__` applies `guard_methods(cls, ("embed_documents", "embed_query"), "embeddings")`. Methods:
`cache_id() -> dict`, `embed_documents(texts) -> float32 [n, d]` **L2-normalised**, and
`embed_query(text) = embed_documents([text])[0]`. Helper `normalise(v)` = `v / (norm(axis=1) + 1e-9)` as float32.

| name | label | order | params | details |
|---|---|---|---|---|
| `sentence_transformers` | Local (sentence-transformers) | 1 | `model: str = "BAAI/bge-small-en-v1.5"` (examples bge-small, bge-base, all-MiniLM-L6-v2) "Hub id or local folder"; `query_instruction: bool = True` "Prefix queries with the BGE retrieval instruction" | cache_id `{"e":"st","m":model}`. available: loaded → `(True,"loaded")`, else `models.status(model)`. encode with batch_size 32, `normalize_embeddings=True`. Query prefix when enabled and "bge" in the lowercased model: `"Represent this sentence for searching relevant passages: "` |
| `openai` | OpenAI embeddings | 2 | `model: str = "text-embedding-3-small"` | cache_id includes `OPENAI_EMBEDDINGS_BASE_URL`; `require_env("OPENAI_API_KEY")`; batches of 256 |
| `ollama` | Ollama embeddings | 3 | `model: str = "nomic-embed-text"` | available: `/api/version` reachable (else "Ollama is not reachable at <url>"), and the model is in `/api/tags` (`model` or `model:latest`, else "run `ollama pull <model>`"); POST `/api/embed {"model","input"}` in batches of 32 |
| `gemini` | Gemini embeddings | 4 | `model: str = "gemini-embedding-001"` | key `GEMINI_API_KEY` or `GOOGLE_API_KEY`; POST `{API}/models/{model}:batchEmbedContents` with header `x-goog-api-key`, batches of 100, `taskType` `RETRIEVAL_DOCUMENT` for documents and `RETRIEVAL_QUERY` for queries |

`app/core/embeddings.py`:
```python
PREFIX = {"local": "sentence_transformers", "st": "sentence_transformers", "ollama": "ollama",
          "openai": "openai", "gemini": "gemini"}
EXAMPLES = ["default", "local:BAAI/bge-small-en-v1.5", "local:BAAI/bge-base-en-v1.5",
            "local:sentence-transformers/all-MiniLM-L6-v2", "ollama:nomic-embed-text",
            "openai:text-embedding-3-small", "openai:text-embedding-3-large", "gemini:gemini-embedding-001"]
resolve_spec(spec)   # None/""/"default" -> settings embedding_model
resolve(spec)        # "prov:model" -> (PREFIX[prov], {"model": model}); bare name -> sentence_transformers;
                     # one-letter prov (Windows drive, C:\...) -> sentence_transformers with the full spec;
                     # unknown prov -> ValueError("Unknown embedding provider '<p>'. Use one of: local, st, ollama, openai, gemini")
make(spec) -> (embedder_instance, component_name, params)
```

### 10.5 llm (base `BaseLLM(Capability, Component)`, `policy_kind="llm"`)
* Class attributes: `uses_model = True` (False only for extractive), `default_model = ""`. `uses_policy()` returns
  `uses_model`.
* `__init_subclass__`: `guard_methods(cls, ("stream","complete"), "llm", applies=lambda self: self.uses_model)`.
* `__init__`: `self.usage = Usage()`, `self.context_chunks = None`. `model_name` = `p.model` or the component name.
* `async ping()` defaults to `available()`. `async stream(system, user)` is an abstract async generator.
  `complete()` joins `stream()`. `_account(tin, tout)` adds usage and cost.
* Prices (USD per 1M tokens, in/out): claude-opus-5-5 15/75, claude-sonnet-5-5 3/15, claude-haiku-5-5 1/5, gpt-4o
  2.5/10, gpt-4o-mini 0.15/0.6, gpt-4.1-mini 0.4/1.6, gpt-4.1 2/8. `LLM_PRICES` JSON in the env extends or overrides
  them; invalid JSON is ignored. Unknown models cost 0. `price()` rounds to 6 decimals.
* Shared `LLMParams`: `temperature: float = 0.1 [0,2]` "Sampling temperature", `max_tokens: int = 512 [16, 4096]` "Max
  output tokens", `streaming: bool = True` "Stream tokens as they are generated".

| name | label | order | default_model / model param | availability | transport |
|---|---|---|---|---|---|
| `ollama` | Ollama (local) | 1 | `model` default = env `OLLAMA_MODEL` or `qwen2.5:1.5b` (`x-suggest: ollama_models`); extra `num_ctx: int = 8192 [1024, 32768]` "Context window passed to Ollama" | GET `/api/version` (else "Ollama is not reachable at <url>. Start it with `ollama serve`."); if models are listed and the model (or `model:latest`) is missing: "Model '<m>' is not pulled. Run `ollama pull <m>`." | POST `/api/chat` `{model, stream, messages:[system,user], options:{temperature, num_predict:max_tokens, num_ctx}, keep_alive:"30m"}` (+ `format:"json"` for JSON mode). Streaming parses JSON lines; an `error` field raises; usage from `prompt_eval_count`/`eval_count` on done. Timeout 600s, connect 5s |
| `anthropic` | Anthropic Claude | 2 | `claude-haiku-5-5` (examples haiku/sonnet/opus 5-5, claude-fable-5-1) | `require_env("ANTHROPIC_API_KEY")`; ping = `models.list(limit=1)` → "key accepted" | `AsyncAnthropic().messages.stream(model, max_tokens, temperature, system, messages=[user])`; usage from the final message |
| `openai` | OpenAI | 3 | `gpt-4o-mini` | `require_env("OPENAI_API_KEY")`; ping = `models.list()` → "connected" | chat.completions stream with `stream_options={"include_usage": True}` |
| `gemini` | Google Gemini | 4 | `gemini-2.5-flash` (examples flash, flash-lite, pro) | key `GEMINI_API_KEY` or `GOOGLE_API_KEY`; ping GET `{API}/models` | `API="https://generativelanguage.googleapis.com/v1beta"`; stream POST `{API}/models/{model}:streamGenerateContent?alt=sse`, header `x-goog-api-key`, body `{systemInstruction:{parts:[{text}]}, contents:[{role:"user",parts:[{text}]}], generationConfig:{temperature, maxOutputTokens}}` (+ `responseMimeType:"application/json"` in JSON mode); usage from `usageMetadata` |
| `azure_openai` | Azure OpenAI | 5 | env `AZURE_OPENAI_DEPLOYMENT` or `gpt-4o-mini` ("Deployment name") | `require_env("AZURE_OPENAI_ENDPOINT","AZURE_OPENAI_API_KEY")` | `AsyncAzureOpenAI(azure_endpoint, api_key, api_version=env or "2024-10-21")` |
| `openai_compatible` | OpenAI-compatible (any) | 6 | env `OPENAI_COMPATIBLE_MODEL` or `llama-3.1-8b-instant` | `require_env("OPENAI_COMPATIBLE_BASE_URL", example="https://api.groq.com/openai/v1")` | `AsyncOpenAI(base_url, api_key=env or "not-needed")` |
| `extractive` | Extractive (no LLM) | 9 | params `sentences: int = 3 [1,10]` "Sentences to quote", `streaming: bool = True` "Stream word by word"; `uses_model = False`; model_name "extractive" | always ready | see below |

OpenAI, Azure and compatible share a `_ChatCompletions(BaseLLM)` base with `client()`, `ping()` and `stream()`.

**Extractive answerer.** `q` = the user prompt text after the last `"Question:"`. Question terms = `set(bm25_tokenize(q))`.
For each context chunk, split `chunk.text` on `(?<=[.!?])\s+|\n+`, strip `" -*#>\t"`, and skip pieces shorter than 15
characters. Score = |terms ∩ sentence terms| / (|terms| + 1e-9). Sort descending and take the top `sentences` with
score > 0. The answer is `" ".join(f"{s} [{cid}]")`, or exactly `"I don't know: no context sentence overlaps with the
question."` if nothing scores. Stream word by word (regex `\S+\s*`), sleeping 10 ms per word when `streaming`. Usage:
`len(user)//4` in, `len(text)//4` out. `complete(json_mode=True)` returns `"{}"`.

### 10.6 retriever
`bm25_tokenize(text, remove_stopwords=True)`: regex `[A-Za-z0-9]+(?:['’][A-Za-z]+)?`, lowercased. Drop stopwords, but
if that leaves nothing, keep the original tokens. STOPWORDS (exact):
`a an and are as at be but by for from has have i if in into is it its of on or that the their then there these they
this to was were will with what when which who how do does should can you your we our not no`.

`bm25_index`: corpus = `bm25_tokenize(c.index_text)` per chunk (`["_"]` if empty), class from
`{"okapi": BM25Okapi, "bm25l": BM25L, "bm25plus": BM25Plus}` with k1 and b, cached in memory.
`bm25_search(queries, cs, k, variant, k1, b, remove_stopwords)`: per query, `get_scores`, keep the top k by score with
score > 0, as `Hit(scores={"bm25"})`. Merge the queries with `_merge_max` (keep the max score per chunk, sort desc, set
`ranks[key]`).

| name | label | order | params |
|---|---|---|---|
| `bm25` | BM25 only | 1 | `top_k 5 [1,50]` "Chunks kept after retrieval/fusion", `candidate_k 20 [1,200]` "Candidates fetched from BM25", `variant Literal okapi\|bm25l\|bm25plus = okapi`, `k1 1.5 [0,3]` "Term-frequency saturation", `b 0.75 [0,1]` "Length normalisation", `remove_stopwords True` "Drop English stopwords before scoring" |
| `dense` | Semantic (dense) only | 2 | `top_k 5`, `candidate_k 20` "Candidates fetched from the vector index", `embedding_model: str = "default"` (x-suggest `embedding_models`), `similarity_threshold 0.0 [0,1]` "Drop candidates below this cosine", `vector_store: str = "default"` (x-options `vector_stores`) |
| `hybrid` | Hybrid (BM25 + dense) | 3 | `top_k 5` "Chunks kept after fusion", `bm25_candidate_k 20`, `dense_candidate_k 20`, variant, k1, b, `remove_stopwords` "Drop stopwords for BM25", `embedding_model`, `similarity_threshold` "Dense cosine cutoff", `vector_store` |

Field helpers in `retrievers/_common.py`:
* `embedding_field()` = `Field("default", description="Embedding model (provider:model), or 'default' to use Settings",
  json_schema_extra={"x-suggest": "embedding_models"})`;
* `vector_store_field()` = `Field("default", description="Vector database for the chunk vectors, or 'default' to use
  Settings", json_schema_extra={"x-options": "vector_stores"})`.

Retriever outputs:
* bm25: `lists={"bm25": hits}`, trace `index_cache={"bm25": hit}`.
* dense: `lists={"dense": hits}`, trace `index_cache={"embeddings": info["cached"]}` and `vector_store=info`.
* hybrid: runs BM25 (in a thread) and dense concurrently; `lists={"bm25","dense"}`, trace index_cache both + vector_store.

`dense_search(queries, cs, k, embedding_model, threshold, vector_store="default", ctx=None, retriever="dense")`:
1. Resolve the spec and the store name.
2. In a worker thread, create the embedder (on error keep `emb=None` and remember the message) and build
   `readiness.dense_report(cs, retriever, spec, emb, store, ctx)`. If `emb` is None, replace the embedder check's detail
   with the error message.
3. If not ready, raise `NotReady(report)`.
4. `vectorstore.ensure(store, cs, emb, lambda: chunk_embeddings(cs, name, params)[1])`. Then per query,
   `vectorstore.search(store, collection, emb.embed_query(q), k)`, keeping cosine ≥ threshold, and merge with
   `_merge_max(.., "dense")`.
5. `Unavailable` re-raises as is. Any other exception calls `vectorstore.forget(store)` and re-raises.
6. Return `(hits, {"vector_store", "collection", "vectors": len(chunks), "cached", "embedding_model": spec,
   "checks": report["checks"]})`.

### 10.7 fuser
`merge_hit(dst, h)` merges the scores and ranks dicts into one Hit per chunk_id.
* `rrf` "Reciprocal Rank Fusion", order 1, `k: int = 60 [1,200]` "RRF damping constant". Docstring: "score = sum
  1/(k + rank) over the lists. Uses ranks only, so it needs no score normalisation." Fused score =
  Σ 1/(k + rank) over the lists. Sort desc, set `scores["fused"]` (rounded to 6) and `ranks["fused"]`.
* `weighted` "Weighted score (alpha)", order 2, `alpha: float = 0.5 [0,1]` "0 = pure BM25 · 1 = pure dense".
  Docstring: "fused = (1 - alpha) * norm(bm25) + alpha * norm(dense), each min-max normalised. alpha 0 = pure BM25,
  1 = pure dense." Min-max per list (all-equal → 1.0, missing → 0).

### 10.8 reranker
* `none` "None" (order 0): "Keeps the retrieval order." Returns `(hits, [])`.
* `cross_encoder` "Cross-encoder" (order 1): `model: Literal["cross-encoder/ms-marco-MiniLM-L-6-v2",
  "BAAI/bge-reranker-base"]` default MiniLM, `rerank_top_n: int = 5 [1,50]` "Chunks kept after reranking". If
  embeddings are not allowed → `Unavailable("cross-encoder skipped: <POLICY_EMB>")`. If the model isn't loaded and
  `models.status` is not ok → `Unavailable("cross-encoder skipped: <why>")`. Predict on pairs
  `(question, chunk.index_text)` in a thread, then `apply_rerank`.
* `apply_rerank(hits, scores, top_n)`: `scores["rerank"]` rounded to 4, sorted desc, `ranks["rerank"]`. Keep top_n;
  the rest get `dropped_by="rerank"` and `drop_reason=f"rerank rank #{r} > top_n {n}"`.
* `llm` "LLM reranker" (order 2): `rerank_top_n 5`, `max_candidates: int = 10 [1,30]` "Only the top-N candidates are
  sent to the LLM". Uses `ctx.llm_factory()`. If not `ready()` → `Unavailable(f"LLM reranker skipped: {why}")`. System
  prompt: "Rate how useful the passage is for answering the question, from 0 (irrelevant) to 10 (directly answers it).
  Reply with the number only."; user prompt: `"Question: {q}\n\nPassage:\n{text[:1500]}\n\nScore:"`. Parse the first
  number (min 10, else 0). Candidates beyond max_candidates are dropped with "beyond max_candidates". The trace records
  llm_usage.
* `mmr` "MMR (diversity)" (order 3): `lambda_` (alias `"lambda"`, `populate_by_name`) `= 0.7 [0,1]` "1 = pure relevance
  · 0 = pure diversity", `rerank_top_n 5` "Chunks kept", `embedding_model` field. If the embedder isn't ready →
  `Unavailable(f"MMR needs embeddings: {why}")`. Greedy: `score_i = λ·rel_i − (1−λ)·max_j∈chosen(V_i·V_j)` over all
  hits. `scores["rerank"]` rounded to 4. Drop reason `f"MMR rank #{r} > top_n {n}"`.

### 10.9 query_transform
`_util.parse_lines(text, n)`: strip leading bullets/numbers/"Q1:"/"Sub-question 1:" and quotes, keep lines longer than
3 characters, first n. `_util.llm_call(ctx, system, user)`: `llm = ctx.llm_factory()`; if not ready →
`Unavailable(f"query rewrite skipped: {why}", what="llm")`; else complete, append usage to
`ctx.trace["llm_usage"]`, and strip.

| name | label | order | params | behaviour |
|---|---|---|---|---|
| `none` | None | 0 | – | queries = dense = [q] |
| `rewrite` | Query rewrite | 1 | `keep_original True` "Also search with the original question" | system "You rewrite user questions into concise search queries for a style guide. Output only the rewritten query on one line."; notes `rewritten` |
| `multi_query` | Multi-query | 2 | `n 3 [2,6]` "Number of rewrites", `keep_original True` "Include the original question" | system f"Generate {n} different search queries that would help answer the question from a writing style guide. Use varied vocabulary. One per line, no numbering."; notes `queries` |
| `hyde` | HyDE | 3 | `include_question True` "Also embed the raw question" | system "Write a short passage (3-4 sentences) from a writing style guide that answers the question. Be specific; invent plausible details if needed."; queries=[q], dense = [q?] + [hypo]; notes `hypothetical_doc` |
| `decompose` | Decomposition | 4 | `max_sub_questions 3 [2,5]` "Maximum sub-questions" | system f"Break the question into at most {n} simple, self-contained sub-questions that together answer it. If it is already simple, repeat it. One per line."; queries = [q] + subs; notes `sub_questions` |

The user message is always `f"Question: {question}"`.

### 10.10 context_filter `standard` "Filter chain"
Docstring: "In order: score threshold, near-duplicate removal, neighbour expansion, merging adjacent chunks, token
budget."

Params:
* `score_threshold 0.0 [0,1]` "Drop hits whose best normalised score is below this"
* `threshold_on Literal auto|rerank|fused|dense|bm25 = auto` "Score used for the threshold"
* `dedupe True` "Remove near-duplicate chunks"
* `dedupe_jaccard 0.85 [0.5,1]` "Word-Jaccard at or above this counts as a duplicate"
* `expand_neighbors 0 [0,3]` "Also include ±N neighbouring chunks"
* `merge_adjacent False` "Merge chunks that are next to each other in the document"
* `max_context_tokens 3000 [128, 32000]` "Token budget for the whole context"

Steps:
1. Threshold (only if > 0): the key for `auto` is the first of rerank/fused/dense/bm25 present in the first hit's
   scores. Min-max normalise; drop below → `dropped_by="context_filter"`, reason `f"{key} normalised {nv:.2f} <
   {threshold}"`.
2. Dedupe: word-Jaccard on `bm25_tokenize(text, False)` sets against already kept hits. Reason
   `f"near-duplicate of {id}"`.
3. Neighbour expansion: add `±N` chunks by index not already present, as new Hits with empty scores and
   `drop_reason=f"neighbour of {id}"`.
4. merge_adjacent: sort kept by document index; trace `merged_groups` = consecutive index runs as chunk ids.
5. Token budget: accumulate chunk tokens; over budget → dropped with `f"token budget {budget} exceeded"`. Trace
   `context_tokens`.

Returns `(kept, dropped)`.

### 10.11 prompt `template` "Template"
Docstring: "An editable template with {context} and {question} placeholders, plus optional citation and abstention
rules."

Params:
* `template` (x-widget textarea) default
  `"Use the style-guide excerpts below to answer the question.\n\nContext:\n{context}\n\nQuestion: {question}\n\nAnswer:"`
  "Prompt template ({context}, {question})"
* `system` (textarea) default `"You are a precise assistant that answers questions about a writing style guide."`
  "System prompt"
* `cite_chunk_ids True` "Ask the model to cite chunk IDs like [C3]"
* `strict_context True` "Answer only from context, otherwise say \"I don't know\""
* `include_source_location True` "Show the page/heading next to each chunk in the context"

`build(question, chunks, closed_book)`:
* closed book → user = `"Answer the question about writing style from your own knowledge.\n\nQuestion:
  {question}\n\nAnswer:"`, system unchanged.
* Rules:
  * cite → `"After each fact, cite the ID of the chunk it came from in square brackets, like [C3]."`
  * strict → `"Use only the context. Only if no part of the context is relevant, reply exactly: I don't know."`
  * Append the rules to the system prompt as `"\n- rule"` lines.
* Context = for each chunk `f"[{id}]{loc}\n{text}"`, joined with blank lines, where loc = `" (p.N; Heading > Path)"`
  when enabled (parts joined by `"; "`). With no chunks: `"(no context)"`.
* If the template lacks `{question}`, append `"\n\nQuestion: {question}"`. Substitute with `str.replace`.
* If any rules exist, strip a trailing `"Answer:"`, then append `"\n\nInstructions: Answer the question in 1-4 sentences
  using the context above. " + " ".join(rules)`, and re-append `"\n\nAnswer:"` if it was there. (Small local models
  follow rules far better when they sit just before the answer. Do NOT add a literal example answer; the 1.5B model
  copies it.)
* Returns `{"system", "user", "closed_book"}`.

### 10.12 judge
* `heuristic` "Heuristic (offline)", order 2. Docstring: "Offline, deterministic scoring: token-F1 correctness, lexical
  groundedness, citation overlap and abstention regex."
  * correctness: expected abstention (category unanswerable/false_premise) → 5 if abstained else 1; otherwise
    `round(1 + 4*min(1, token_f1(answer, expected)*1.6), 2)`;
  * faithfulness: `1 + 4 * share of answer tokens (citations removed) present in the context tokens`, None without
    context;
  * `citation_accuracy = |cited ∩ gold| / |cited|` (None if either is empty), rounded to 3;
  * `abstention_correct = (abstained == expected)` if either is true, else None;
  * `rationale "heuristic"`.
* `ABSTAIN` regex (exact, case-insensitive):
  `\b(i (do not|don't|dont) know|not (mentioned|covered|specified|stated|addressed|provided)|(no|does not contain|doesn't contain) (information|mention)|cannot (find|answer|determine)|unable to (find|answer|determine)|isn't (covered|mentioned)|(does not|doesn't) (provide|mention|cover|say|specify|address|include|contain|state)|no (specific )?(guidance|rules?|instructions?) (on|about|for))\b`
* `token_f1(a, b)`: Counter overlap of `bm25_tokenize` tokens, F1.
* RUBRIC text (Appendix A).
* `llm` "LLM judge", order 1:
  * params `provider: str = "default"` (x-options `llm_providers`) "Judge LLM provider, or 'default' to use Settings";
    `model: str = ""` (x-suggest `ollama_models`) "Judge model ('' = provider default)".
  * `llm = providers.make_llm(provider, model, temperature=0.0, max_tokens=300)`. If not ready → the heuristic result
    with rationale `f"LLM judge unavailable ({why}); used the heuristic judge"`.
  * Prompt: rubric + question + category + expected answer + context (each chunk's `[id] text[:800]`, total 6000
    chars) + system answer, asking for JSON `{"correctness": 1-5, "faithfulness": 1-5, "abstained": true/false,
    "rationale": "..."}`. System: "You are a strict, fair evaluator of RAG answers. Output JSON only.", json_mode.
  * Clamp to 1–5. Parse failure → heuristic with rationale `f"judge parse failed ({e}); used the heuristic judge"`.

### 10.13 vector_store
Base `VectorStore(Component)` in `vector_stores/_base.py`:
* `needs: str` (human-readable requirements);
* `available() -> (ok, detail)` (a real connection check);
* `location() -> str`;
* `count(name) -> int` (0 if missing);
* `reset(name)` (drop if it exists);
* `upsert(name, ids, vectors, texts, metas)`;
* `query(name, vector, k) -> [(chunk_id, cosine)]` (best first);
* `collections() -> [{name, count}]`;
* `close()`.

Helper: `missing_package(pkg, pip=None)` = `f"Python package '{pkg}' is not installed: pip install {pip or pkg}"`.
**Secrets and DSNs are read from the environment only, never from params.**

| name | label | order | details |
|---|---|---|---|
| `in_memory` | In-memory (NumPy, exact) | 0 | Module dict `name -> (ids, matrix)`. available `(True, "always available")`, location "process memory". upsert vstacks. query = `mat @ v`, argsort desc |
| `chroma` | Chroma | 1 | Singleton client: `chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT or 8000)` if `CHROMA_HOST` is set, else `PersistentClient(path=CHROMA_PATH or DATA_DIR/"chroma")`, both with `Settings(anonymized_telemetry=False)`. available: import (else missing_package) + `heartbeat()` → `"connected · <location>"`. upsert: `get_or_create_collection(name, metadata={"hnsw:space":"cosine"})` with `upsert` in batches of 512 (ids, embeddings as lists, documents=texts, metadatas). query: `n = min(k, count)`, `include=["distances"]`, similarity = `1 - distance`. collections: names starting with `rag_`. needs: "pip install chromadb (optional: CHROMA_HOST / CHROMA_PORT for a server, CHROMA_PATH for the folder)" |
| `faiss` | FAISS | 2 | Dir `FAISS_PATH` or `DATA_DIR/faiss`. Files `<name>.faiss` + `<name>.ids.json`, plus an in-process cache. Index `IndexFlatIP(d)` (default) or `IndexHNSWFlat(d, 32, faiss.METRIC_INNER_PRODUCT)` when `FAISS_INDEX=hnsw`. available `"faiss <ver> · <flat\|hnsw> · <dir>"`. query: `index.search(v[None], min(k, ntotal))`, skipping idx < 0. needs: "pip install faiss-cpu (optional: FAISS_INDEX=flat\|hnsw, FAISS_PATH)" |
| `pgvector` | Postgres + pgvector | 3 | DSN = `PGVECTOR_DSN` or `DATABASE_URL`. Table = `"rag_lab_" + re.sub(r"[^a-z0-9_]","",name.lower())`, truncated to 63 chars. `psycopg.connect(dsn, connect_timeout=4, autocommit=True)` per call. available: no DSN → "PGVECTOR_DSN is not set in .env (postgresql://user:pass@host:5432/db)"; connect; try `CREATE EXTENSION IF NOT EXISTS vector` (ignore failure); read `extversion` from pg_extension (missing → "connected, but the pgvector extension is not installed in this database"); ok → `"connected · pgvector <v> · <dsn with password masked as ***>"`. upsert: `CREATE TABLE IF NOT EXISTS t (chunk_id text PRIMARY KEY, embedding vector(d), content text, metadata jsonb)`; `executemany INSERT … %s::vector … %s::jsonb ON CONFLICT (chunk_id) DO UPDATE`; vector literal `"[" + ",".join(f"{x:.7g}") + "]"`; then try `CREATE INDEX IF NOT EXISTS "<t[:55]>_hnsw" ON t USING hnsw (embedding vector_cosine_ops)`. query: `SELECT chunk_id, 1 - (embedding <=> %s::vector) FROM t ORDER BY embedding <=> %s::vector LIMIT %s`. count via `to_regclass`. collections: tables `LIKE 'rag_lab_rag_%'`. needs: "pip install 'psycopg[binary]' and set PGVECTOR_DSN=postgresql://user:pass@host:5432/db (pgvector extension installed)" |
| `pinecone` | Pinecone | 4 | `Pinecone(api_key=PINECONE_API_KEY[, host=PINECONE_HOST])` singleton. One index `PINECONE_INDEX` (default "rag-lab"); **each collection is a namespace**. available: no key → "PINECONE_API_KEY is not set in .env"; import; `list_indexes()`; if the index exists → `"connected · index '<n>' (<dim>d, <metric>)"`, else `"connected · index '<n>' will be created on first use"`. On upsert, a missing index is created with `create_index(name, dimension=d, metric="cosine", spec=ServerlessSpec(cloud=PINECONE_CLOUD or "aws", region=PINECONE_REGION or "us-east-1"))`. A dimension mismatch raises `Unavailable("Pinecone index '<n>' is <D>-d but the embedding model makes <d>-d vectors. Use another PINECONE_INDEX or embedding model.", what="vector_db")`. Records `{"id", "values", "metadata": {**meta, "text": text[:2000]}}` in batches of 100. count from `describe_index_stats().namespaces[name].vector_count` (supports object or dict). reset = `delete(delete_all=True, namespace=name)`, ignoring errors. query → matches (object or dict). needs: "pip install pinecone and set PINECONE_API_KEY (optional: PINECONE_INDEX, PINECONE_CLOUD, PINECONE_REGION)" |

Docstrings (shown in the UI):
* in_memory: "Exact brute-force cosine search over a NumPy matrix in this process. Nothing to install or configure;
  rebuilt after a restart (from the embedding cache)."
* chroma: "Chroma vector database (HNSW, cosine). Embedded and persisted to data/chroma by default; set CHROMA_HOST to
  use a Chroma server."
* faiss: "Facebook AI Similarity Search: a local index file per collection in data/faiss. FAISS_INDEX=flat (exact,
  default) or hnsw (approximate, for large corpora)."
* pgvector: "PostgreSQL with the pgvector extension: one table per collection, cosine distance, HNSW index. Set
  PGVECTOR_DSN (e.g. postgresql://user:pass@host:5432/db)."
* pinecone: "Pinecone serverless index; each collection is a namespace in one index (PINECONE_INDEX, default rag-lab,
  cosine). The index is created on first use if it does not exist."

---------------------------------------------------------------------------------------------------------------------

## 11. Vector-store layer: `app/core/vectorstore.py`

* `resolve(name)`: None/""/"default" → settings `vector_store`.
* `names()` = registered store names.
* `store(name)`: cached instance per name. An unknown name raises the registry KeyError.
* `check(name, fresh=False) -> (ok, detail)`: cached for **`AVAIL_TTL = 20` s**, and exceptions become
  `(False, "<Type>: <msg>")`.
* `collection_name(cs, emb_cache_id) = "rag_" + stable_hash(cs.key, emb_cache_id)[:32]`.
* Metadata per chunk: `{doc_id, chunk_id, index, start, end, tokens, heading: " > ".join(heading_path)}`, plus `page`
  when not None.
* `indexed_count(store, cs, emb)` returns the store count (0 on error).
* `ensure(store, cs, emb, compute_vectors) -> (collection_name, was_cached)`:
  * the `_ready` set holds known-complete (store, name) pairs, and a per-key lock prevents duplicate builds;
  * `cached = st.count(name) == len(chunks)`; if not, `reset(name)`, compute the vectors (float32), and upsert
    (ids, vectors, `index_text`s, metas);
  * add to `_ready`.
* `search(store, name, qvec, k) = store(store).query(...)`.
* `stats()`: per registered store `{store, label, ok, detail, location, collections}`, filling location and
  collections only when ok.
* `forget(store=None)`: clear `_ready` and the availability cache (all, or only one store). Called after any settings
  change and after a mid-search failure.

---------------------------------------------------------------------------------------------------------------------

## 12. Readiness ("pre-flight") report: `app/core/readiness.py`

`class NotReady(Unavailable)` carries a `report` dict (reason = headline, `what="retrieval"`).

`dense_report(cs, retriever, emb_spec, emb, store_name, ctx=None) -> report`. Checks are appended in this order. Each
check is `{id, label, state, detail, fix}`, where state is one of `ok | missing | pending | fallback | info`:

1. `chunks` "Document chunked": ok, `f"{len(chunks)} chunks ready"`.
2. hybrid only: `bm25` "BM25 keyword index": ok, "ready (no model needed)".
3. `vector_db` `f"Vector DB · {store label}"`: from `vectorstore.check`. ok → detail = why or "connected". Missing →
   detail = why, fix = the store's `needs` or "Choose another vector store in ⚙ Settings.", and add `vector_db` to
   missing.
4. `embedder` `f"Embedding model · {emb_spec}"`: `emb.ready()` (emb None → (False, "unknown embedding model")). ok →
   detail why or "available". Missing → fix = `_emb_fix(why, spec)`, and add `embedder` to missing.
5. Only if the vector DB is ok and emb is not None: `vectors` "Vectors for these chunks". If
   `indexed_count == len(chunks)` → ok `f"{n} stored in {label}"`; else pending with detail "built automatically on the
   first run once the embedding model is available" (embedder missing) or "will be built on this run".
6. If `ctx.llm_factory`: `llm` `f"Answer LLM · {component_name} · {model_name}"`. Ready → ok "ready"; else **fallback**
   `f"{why}. BM25-style extractive answers are used instead."`. On exception: label "Answer LLM", fallback, str(e).

`_emb_fix(reason, spec)`:
* reason == POLICY_EMB: if locked → `f"Locked by {lock}. Ask for an approved embedding model, then set it to true."`,
  else `"Turn on 'Embedding / reranker models' in ⚙ Settings (or RAG_LAB_ALLOW_EMBEDDINGS=true in .env)."`;
* "API_KEY" in reason → `f"Add the key to rag-lab/.env and restart the backend, or pick another embedding model than {spec}."`;
* "not downloaded" or "unreachable" in reason → `"Copy the model folder onto this machine and set EMBEDDING_MODEL=local:<folder path> in .env."`;
* "ollama" in lowercase reason → the reason itself;
* else `"Pick another embedding model in ⚙ Settings or on this pane's Retrieve stage."`

Report fields:
* `ready = not missing`;
* `missing` sorted;
* `headline` = "All systems go" if ready, else `f"{'Hybrid' if retriever=='hybrid' else 'Semantic'} search is plugged
  in and waiting for {what}"`, where `what` joins the sorted missing items with " and ", mapping `embedder→"an
  embedding model"` and `vector_db→"a vector database"`;
* `quip` ("" when ready): a group is chosen (`both` if both missing, else `vector_db` if the DB is missing, else
  `embedder`), and the line is `options[int(md5(seed).hexdigest(), 16) % len(options)]` with
  `seed = cs.key + retriever`. Quip texts are in Appendix A;
* `ok_count` = number of checks with state ok; `total` = number of checks;
* `retriever`, `checks`.

---------------------------------------------------------------------------------------------------------------------

## 13. Providers and capabilities: `app/core/providers.py`

* `resolve_llm(provider, model) -> (prov, model)`: prov = settings `llm_provider` if provider is None/""/"default".
  If a model is given, return it. Else, if prov equals the settings provider and settings `llm_model` is non-empty,
  return that. Else return the provider class's `default_model` (or "").
* `make_llm(provider=None, model=None, **params)`: create the llm with params, plus `model` if the provider's Params has
  a `model` field and a model was resolved.
* `capabilities(fresh=False)`: if fresh, `vectorstore.forget()`. Returns:
  * `settings`, `locks`, `mode`;
  * `any_llm_ready`;
  * `llms`: one row per llm `{name, label, description, ready, detail, uses_model, default_model, examples}`, where
    ready/detail come from `create(...).ready()` and examples from the model field's `json_schema_extra.examples`;
  * `embedders`: rows `{name, ready, detail}` for `embeddings.EXAMPLES[1:]`, plus the current setting first if it is
    not in EXAMPLES. Status is cached 60 s per spec unless fresh; if embeddings are disallowed, the policy message is
    returned without probing;
  * `vector_stores`: rows `{name, label, description, ready, detail, needs}`.
  * mode: `offline` if both switches are off, `no_llm` if only LLMs are off, `no_embeddings` if only embeddings are off,
    else `full`.
* `async ping_llm(provider)`: if LLM calls are disallowed → `{"ok": False, "detail": POLICY_LLM}`. Else `llm.ping()`
  with a 12 s timeout → `{"ok", "detail"}`.

## 14. Default panes: `app/core/defaults.py`

`DEFAULT_CHUNKING = {"component": "heading_aware", "params": {"chunk_size_tokens": 256, "overlap_tokens": 32}}`.
`default_pipeline(pid, name, color, retriever)` returns `PipelineConfig(...).model_dump()` with these stages:

| stage | enabled | component | params |
|---|---|---|---|
| query_transform | **False** | multi_query | {} |
| chunking | True | heading_aware | 256 / 32 |
| retrieval | True | `retriever` | `{"top_k": 5}` |
| fusion | `retriever == "hybrid"` | rrf | {} |
| rerank | `retriever == "dense"` | cross_encoder | {} |
| context_filter | True | standard | {} |
| prompt | True | template | {} |
| generation | True | `resolve_llm(None, None)[0]` | `{"model": m}` only if a model is resolved and the provider has a model field |

`default_panes()` = `[A "BM25" indigo bm25, B "Semantic" emerald dense, C "Hybrid RRF" amber hybrid]`. It is
recomputed on every request, so it follows Settings.

---------------------------------------------------------------------------------------------------------------------

## 15. Pipeline orchestrator: `app/core/pipeline.py`

```python
STAGES = ["query_transform", "chunking", "retrieval", "fusion", "rerank", "context_filter", "prompt", "generation"]
class StageConfig(BaseModel): enabled: bool = True; component: str; params: dict = {}
class PipelineConfig(BaseModel): id: str = "A"; name: str = "Pipeline"; color: str = "indigo"
                                 tokenizer: str = "tiktoken"; stages: dict[str, StageConfig]
CITE = re.compile(r"\[([^\]]*C\d+[^\]]*)\]")
extract_citations(answer)  # all "C\d+" inside [...] groups, unique, in order
```

`async run_pipeline(doc, cfg, question, emit=None, stream_tokens=True) -> result dict`.
`ctx = Ctx(doc, tokenizer=create("tokenizer", cfg.tokenizer), llm_factory=gen_llm)`, where `gen_llm()` creates the
pane's generation LLM. `notices` is a list of `{stage, message}`.

**Stage runner** `stage(name, fn, skip_reason=None, passthrough=None)`:
* emit `stage_start {stage, component}` and reset `ctx.trace`;
* if `skip_reason`: status skipped, emit `stage_end {stage, status:"skipped", reason, ms:0, component}`, return None;
* else `value, trace, count_in, count_out = await fn()`. Then:
  * `NotReady` → status `not_ready`, traces[name] = `{"readiness": report}`, emit `stage_end {status:"not_ready", ms,
    component, reason: headline, trace:{readiness: report}}`, and raise `PaneNotReady(name, report)`;
  * `Unavailable` → status skipped, reason `"fallback: <reason>"`, trace `{"skipped": reason, "fallback": True,
    **ctx.trace}`, append to notices, emit stage_end skipped with trace, return None;
  * any other exception → status error, emit `stage_end {status:"error", ms, error:"<Type>: <msg>", component}`, and
    raise `StageError(name, msg)`;
  * success → `timings[name] = ms`, trace merged with ctx.trace, status ok (or skipped with `trace["skipped"]` when
    `passthrough` is given), emit `stage_end {status, ms, count_in, count_out, component, trace[, reason]}`.

**Stage flow and passthrough semantics** (MUST match exactly):

| stage | disabled → | notes |
|---|---|---|
| query_transform | skipped "disabled: original question used" → `QueryBundle(q,[q],[q])` | a None value (fallback) also means the original question |
| chunking | passthrough "disabled: whole document is one chunk" (runs `get_chunkset(enabled=False)`) | trace `{chunkset_key, cache_hit, chunks, avg_tokens, max_tokens, whole_document}`. If the chunker is Unavailable (value None), use `get_chunkset(doc, "heading_aware", {}, True)` and set `traces["chunking"]["fallback_chunker"]="heading_aware"` |
| retrieval | skipped "disabled: closed-book (no context)" (closed_book = True) | trace `{lists, queries, dense_queries}`; `top_k` = the retriever params' `top_k` (default 5) |
| fusion | skipped "no retrieval" (closed book); skipped "single retriever: nothing to fuse" if fewer than 2 lists; disabled with 2 lists → **interleave round-robin**, trace note "disabled: lists interleaved round-robin" | the fused (or single) list gets `ranks["retrieval"] = i+1`; `hits = fused[:top_k]`; the rest are dropped with `dropped_by="retrieval"`, reason `f"rank #{r} > top_k {top_k}"` |
| rerank | "no retrieval" / "disabled: order unchanged" | returns (kept, dropped); trace `{ranked}` |
| context_filter | "no retrieval" / "disabled: all chunks kept" | trace `{kept, dropped:[{id, reason}]}` |
| prompt | passthrough "disabled: bare context + question" → user = `"[id]\ntext"` joined by blank lines + `"\n\n"` + question, system "" | `prompt["tokens"]` = tokenizer count of system + user |
| generation | skipped "disabled: retrieval-only run" | see below |

**Generation with autonomous fallback:**
1. `llm = gen_llm()`; `ok, why = llm.ready()`; if not ok, `fallback = why`.
2. `produce(model)`: set `context_chunks`; if `model.p.streaming` and stream_tokens, stream and emit
   `token {text}` per piece; else `complete` and emit one token.
3. If there is no fallback, try produce. On an exception: if some answer was already streamed, re-raise (error);
   otherwise `fallback = "<Type>: <msg[:240]>"`.
4. On fallback: append the notice `f"{component} unavailable ({fallback}); answered extractively from the retrieved
   chunks"`, set `result["answer_source"] = {"kind": "extractive_fallback", "wanted": component, "reason": fallback}`,
   and produce with `create("llm", "extractive", {})`.
5. Usage: `llm.usage` (if input_tokens is 0, use the prompt tokens and a tokenizer count of the answer). Trace
   `{model, provider, usage[, fallback]}`.

**Not ready:** catch `PaneNotReady`, set `result["not_ready"] = report` and `answer=""`, and emit
`stage_end {status:"skipped", ms:0, component, reason:"waiting for " + " and ".join(missing)}` for every later stage.
Then finish, notices, emit `done`, return.
**Stage error:** `result["error"] = {stage, message}`, emit `error {stage, message}` and `done`.

`_finish` sets:
* `timings`, `total_ms` (sum), `traces`, `status`;
* `cited` = `extract_citations(answer)`;
* `ranks["final"]` on hits; `hits` (dumped); `dropped` = unique dropped not in hits, first 40;
* `chunks` = `{id: chunk dump}` for every hit and dropped id;
* `usage` default.

The result also contains `pane`, `question`, `query_bundle`, `chunkset_key`, `num_chunks`, `prompt`, `answer`,
`notices`, and optionally `answer_source`, `not_ready`, `error`.

**SSE event protocol** (emitted by the run endpoint, each payload including `pane`): `stage_start`, `stage_end`,
`token {text}`, `error {stage, message}`, `done {…result}`, then once per request `history {id}` (if saved) and
`all_done {}`. A transport failure produces `fatal {message}`.

---------------------------------------------------------------------------------------------------------------------

## 16. Storage: `app/core/storage.py`

* `safe_name(name, fallback="item")`: remove characters outside `[A-Za-z0-9 _.-]`, collapse runs of 2 or more dots to
  one, strip spaces and dots at the ends, and return the fallback if empty. (Prevents path traversal.)
* `JsonStore(folder)`:
  * `path(key)` = `DATA_DIR/folder/<safe_name(key)>.json`;
  * `get(key)` → dict or None; `put(key, value)` → stem (json default=str); `delete(key)` → bool; `clear()`;
  * `list(limit=None, newest_first=True, where=None)`: sorted by mtime, skipping unreadable files.
* Instances: `history`, `presets`, `qsets`, `evals`.

---------------------------------------------------------------------------------------------------------------------

## 17. Question generation: `app/qgen/`

### 17.1 Categories (`categories.py`): 16 entries, in this order, with these exact fields
Each entry is `{id, label, stresses, explain, instruction, sections}`. The `instruction` is used in the LLM prompt and
is NOT returned by `/api/categories`.

| id | label | stresses | sections |
|---|---|---|---|
| single_hop | Single-hop factual | basic retrieval | 1 |
| multi_hop | Multi-hop | multi-hop reasoning | 2 |
| comparison | Comparison | multi-chunk recall | 2 |
| rule_application | Rule application | applying a rule | 1 |
| exception | Exception / edge case | fine-grained detail | 1 |
| conflict | Rule conflict / precedence | multi-hop reasoning | 2 |
| exact_term | Exact-term lookup | BM25 exact term | 1 |
| paraphrase | Paraphrased / lexical mismatch | semantic paraphrase | 1 |
| list_aggregation | List / aggregation | recall / top_k | 2 |
| numerical | Numerical / specific detail | BM25 exact term | 1 |
| negation | Negation | semantic + negation | 1 |
| unanswerable | Unanswerable / out-of-scope | hallucination / abstention | 1 |
| false_premise | False premise / adversarial | hallucination / abstention | 1 |
| ambiguous | Ambiguous / underspecified | clarification | 1 |
| summarization | Summarization / holistic | whole-section recall | 1 |
| multi_turn | Multi-turn follow-up | conversation context | 1 |

`explain` and `instruction` texts are in Appendix C. `BY_ID = {id: entry}`.

### 17.2 Gold-span validation (`generator.py`)
* `locate(doc, quote, hint_spans=None)`: quote stripped of whitespace and `"“”`. Fewer than 8 characters → None.
  Then try in order:
  1. exact `doc.text.find` → match "exact";
  2. normalised match: lowercase, collapse whitespace, drop `*`, `_` and backticks, keeping a map back to original
     offsets → "normalized";
  3. fuzzy: the best sentence (via `sentence_spans`) inside the hint spans (or the whole document) by `token_f1`, only
     if ≥ 0.5 → `"fuzzy(0.xx)"`.

  A span is `{start, end, page, heading_path, quote: text[start:end], match}`.
* `finalize_item(doc, cat, raw, source)`: locate each gold quote using the `_hint` spans; failures go to
  `invalid_quotes`. Returns `{id: uuid4 hex[:8], category, question, expected_answer, gold_spans, difficulty
  (easy|medium|hard else medium), what_it_stresses: category stresses, notes, source, valid, invalid_quotes}`, where
  `valid = cat in ("unanswerable","ambiguous") or bool(spans)`.
* `revalidate(doc, item)`: re-locate all quotes (from existing spans + invalid quotes) without hints, and recompute
  `valid`.

### 17.3 Generation
* `_section_list(doc)`: for each `sections(doc)` span, keep those whose body (stripped) is ≥ 60 characters and that have
  at least one sentence longer than 25 characters not starting with `#`. Entries are `{start, end, title: last heading
  or doc name, path, sents}`.
* `_pick(secs, k, rng, used)`: least-used first (Counter), random tie-break, increment usage.
* `generate(doc, categories: {id: count}, mode="llm", llm_cfg=None, seed=7, progress=None)`:
  * `rng = random.Random(seed)`;
  * in LLM mode, `llm = providers.make_llm(cfg.provider, cfg.model, temperature=0.4, max_tokens=600)`; if not
    `ready()`, `llm = None` and set the note `f"LLM unavailable ({why}); used heuristic templates"`;
  * jobs = one per requested question, run concurrently with `asyncio.Semaphore(2)`;
  * each job tries `llm_item` (an exception gives source `f"heuristic (llm failed: {Type})"` and falls back), then
    `heuristic_item`. Sources: "llm" or "heuristic". Emit `progress {done, total[, item]}`;
  * sort the items by category order, then id. Append the LLM note (if any) to each item's notes with " · ".
* **LLM item prompt**:
  * Passages: `"Passage A (section: <path>):\n<text[:2500]>"` (and B for 2-section categories; a single section is
    duplicated);
  * user = passages + `"\n\nTask: create ONE test question of type '<label>'.\n<instruction>\ngold_quotes must be
    sentences copied VERBATIM from the passages that support the answer"` + (for unanswerable: `" (use an empty list,
    since the answer is not in the passages)"`) + `".\nReturn JSON only: {"question": "...", "expected_answer": "...",
    "gold_quotes": ["exact sentence copied from a passage", ...], "difficulty": "easy|medium|hard", "notes": "..."}"`
    (multi_turn adds `, "first_turn": "..."`);
  * system: "You create evaluation datasets for retrieval-augmented generation over a style guide. Output strict
    JSON.", json_mode;
  * parse the first `{...}`. multi_turn question = `(Follow-up to: "<first_turn>") <question>`. Keep at most 4 gold
    quotes. Notes are truncated to 300 characters.
* **Heuristic templates** (exact question strings; `title` = the section title; lower-cased where shown):
  * single_hop: `According to the guide, what is the rule about {title.lower()}?` (expected = cleaned sentence);
  * multi_hop / comparison / conflict / list_aggregation pick 2 sections (a, b), one random sentence each:
    * `What do the guide's rules on {ta} and on {tb} together require of a writer?`
    * `How does the guidance on {ta} differ from the guidance on {tb}?`
    * `If the rules on {ta} and {tb} seem to conflict in the same sentence, which should take precedence?`
    * `List all the rules the guide gives about {ta} and {tb}.`

    Expected = sentence A + " / " + sentence B;
  * rule_application: a sentence matching `\b(use|write|prefer|avoid|always|never|spell)\b` →
    `Rewrite a sentence so that it follows this part of the guide ('{title}'). What rule must the rewrite apply?`;
  * exception: a sentence matching `\b(except|unless|however|exception|only when|but)\b` →
    `When does the guidance on {title.lower()} not apply?`;
  * numerical: a sentence containing a digit; num = first `\d[\d,.%]*` →
    `What specific number or limit ({num}) does the guide give in the section on {title.lower()}, and what does it apply to?`;
  * exact_term: a sentence containing a word that appears ≤ 2 times in the doc, is longer than 4 characters and isn't a
    stopword; term = the rarest such word (original casing found by regex) →
    `What does the guide say about "{term}"?`;
  * paraphrase: `In plain terms, what's the advice I should follow when dealing with {title.lower()}?` (note
    "heuristic: paraphrase quality is limited; LLM mode gives better lexical mismatch");
  * negation: a sentence matching `\b(not|never|avoid|don't|do not)\b` →
    `What should you NOT do regarding {title.lower()}?`;
  * unanswerable: a random one of 5 fixed questions (Appendix C), expected "I don't know: the guide does not cover
    this.", no gold;
  * false_premise: `Why does the guide say the rules on {title.lower()} can be ignored in formal documents?`, expected
    "The guide does not say that; the premise is false.";
  * ambiguous: `What's the right way to do it for {first word of title, lowercased}?`, expected
    "Ambiguous: should ask for clarification or cover the rules in: {title}";
  * summarization: `Summarize the guidance in the '{title}' section.`, gold = the first 3 sentences;
  * multi_turn: `(Follow-up to: "What does the guide say about {title.lower()}?") Are there any exceptions to that?`,
    with notes "turn 1: …".

  Difficulty: hard for multi_hop, conflict, false_premise, list_aggregation; medium for comparison, exception,
  rule_application, paraphrase, negation; otherwise easy. `_clean(t)` removes `*_`#>` and collapses whitespace.
  `_hint` = the picked section span(s).

---------------------------------------------------------------------------------------------------------------------

## 18. Question analysis ("why is this a good test?"): `app/qgen/analysis.py`

Deterministic, no LLM. Inputs: `doc`, `items`, `chunking` (default `DEFAULT_CHUNKING`), `embedding_model` (default
Settings).

**Context `_Ctx`:**
* the chunk set via `get_chunkset`;
* BM25 Okapi (k1 1.5, b 0.75, stopwords removed);
* per-chunk token sets of `index_text`;
* `df` Counter; `doc_count` = Counter of `bm25_tokenize(doc.text)`;
* `by_stem` = map stem → words;
* dense: `embeddings.make(spec)` and, if `ready()`, `vecs = chunk_embeddings(...)`; otherwise
  `dense_note = "semantic rank not measured: <why>"`;
* `idf(t) = log((n - df + 0.5)/(df + 0.5) + 1)`;
* `sections_with(t, exclude)`: unique labels (last heading, else chunk id) of chunks containing t, excluding gold.

**Helpers:**
* `_stem(w)`: strip the first matching suffix from `ations, ation, ings, ing, ions, ion, ies, ied, es, ed, ly, s` when
  `len(w) > len(suffix) + 3`.
* Terms of the question: `bm25_tokenize(q)` (stopwords removed), keeping unique tokens with length > 2 that are not in
  FILLER (and whose `rstrip("'s")` is not in FILLER). FILLER is in Appendix A.

**Per item:**
* `gold_ids` = chunks overlapping the gold spans. Gold quote tokens = tokens of the span quotes; gold chunk tokens =
  the union of gold chunks' token sets; `gold_sections` = sorted unique last heading of each span.
* **Term status:** `gold` (in the gold quote) > `gold_section` (in a gold chunk) > `elsewhere` (df > 0) > `variant`
  (other words share its stem) > `absent`.

  Row = `{term, status, chunks: df, occurrences, idf (2 dp), variants (≤3, variant only), also_in (≤4) + also_in_count
  (for gold/gold_section/elsewhere when non-empty)}`.
* `gap_terms`: gold-quote tokens not in the question, length > 3, not sharing a stem with a question term, sorted by
  IDF desc, top 6.
* `overlap` = Σ idf(gold or gold_section terms) / Σ idf(all terms) (or 1), rounded to 2. None if there are no gold
  chunks.
* `identifiers`: matches of
  `\b[A-Z]{2,}[-_]?\d+\b|\b\d[\d,.:%]*\b|\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)+\b|\"[^\"]{3,40}\"|'[^']{3,40}'`, with quotes
  stripped, kept only if found in the document text (case-insensitive) and not a pure section number
  (`\d+(\.\d+)*\.?`), max 4.
* `negation` regex: `\b(not|never|no|without|except|unless|avoid|don't|doesn't|isn't|aren't|can't|cannot|shouldn't|mustn't)\b`
  (case-insensitive).
* `multi` = spans cover more than one distinct heading path.
* **Ranks** (1-based rank of the first gold chunk under a stable argsort, descending):
  * `bm25` from `bm25.get_scores(bm25_tokenize(q))`;
  * `semantic` from `vecs @ embed_query(q)` (None if not measured);
  * `hybrid` from RRF (k=60) over the full BM25 and semantic rankings (None if semantic is None);
  * `of` = number of chunks.
* `top_distractor`: the non-gold chunk with the highest BM25 score if > 0: `{chunk, section, beats_gold: bm25_rank > 1}`.

**Verdict** (`NO_GOLD = {unanswerable, ambiguous, false_premise}`):
* no gold chunks or category in NO_GOLD → `abstention`;
* semantic not measured (estimated), with `b = bm25 rank or 99`: `b ≤ 2 and overlap ≥ 0.4` → bm25; `b ≥ 5 or overlap
  ≤ 0.25` → semantic; `b ≤ 2` → baseline; else hybrid;
* measured (None → 99): `b≤2 & d≤2` → baseline; `b≤2 & d≥4` → bm25; `d≤2 & b≥4` → semantic; `h≤3 & b>3 & d>3` →
  hybrid; `b>5 & d>5` → hard; `b<d` → bm25; `d<b` → semantic; else hybrid;
* then, if the target is baseline or hybrid and (multi or category in multi_hop/comparison/list_aggregation/
  summarization) → `reasoning`.

`TARGET_INFO` labels / "tests":

| target | label | tests |
|---|---|---|
| bm25 | BM25 test | keyword (BM25) retrieval |
| semantic | Semantic test | semantic (embedding) retrieval |
| hybrid | Hybrid test | hybrid fusion of BM25 + semantic |
| hard | Hard for all | query rewriting, reranking or chunking |
| baseline | Baseline | the whole pipeline (sanity check) |
| abstention | Abstention | whether the answer step declines instead of inventing |
| reasoning | Reasoning | multi-chunk recall and the answer step |

Reasons (in order), headlines and "if it fails" texts are verbatim in Appendix D.

**Category mismatch:** `INTENDED = {paraphrase: semantic, exact_term: bm25, numerical: bm25, unanswerable: abstention,
false_premise: abstention}`. A mismatch exists when the category is intended, the target differs, and NOT
(intended bm25 and target baseline and bm25 rank ≤ 1). Message texts are in Appendix D.

Return per item: `{target, label, tests, category_mismatch, headline, reasons, if_fails, estimated (est and target !=
abstention), terms, gap_terms, overlap, identifiers, negation, gold_chunks (sorted), gold_sections, ranks{bm25,
semantic, hybrid, of}, top_distractor}`.

**Suggestions:** groups of `{id, title, hint, items[{id, question, label, ranks, why=headline}]}`, keeping only
non-empty groups. Missing ranks sort as 99.

| id | title | hint | filter | sort key | n |
|---|---|---|---|---|---|
| semantic | Best checks for semantic-search accuracy | Semantic finds the answer, BM25 doesn't. The bigger the gap, the better the check. | target semantic | (sem − bm25, sem) | 5 |
| bm25 | Best BM25 / exact-term checks | Exact words or identifiers carry these. Semantic search tends to rank them lower. | target bm25 | (bm25 − sem, bm25) | 5 |
| hybrid | Where hybrid earns its keep | Neither method alone ranks the answer high, but fused they do. | target hybrid | hybrid | 5 |
| hard | Stress tests (hard for everything) | Use these to judge query rewriting, reranking or chunking changes. | target hard | −(bm25 + sem) | 5 |
| abstention | Hallucination traps | No passage answers these. A good pipeline says it doesn't know. | target abstention | 0 | 5 |
| baseline | Sanity baselines | Every method should pass these. Run them after any change. | target baseline or reasoning | bm25 + sem | 3 |

`counts` = Counter of targets. `advice` (in order, each only if its condition holds; texts in Appendix D):
mismatches > 0; no semantic target; no bm25 target; no abstention target; baseline count > 60% of the items.

`analyze(...)` returns `{analyses: {id: …}, suggestions: {groups, counts, advice}, context: {chunks, chunker,
embedding_model, semantic_measured, note}}`.

---------------------------------------------------------------------------------------------------------------------

## 19. Evaluation: `app/evaluation/`

**metrics.py:**
* `overlaps(a_start, a_end, b_start, b_end) = a_start < b_end and b_start < a_end`;
* `gold_chunk_ids(chunks, spans)`;
* `spans_covered`;
* `hit_at_k(ranked_ids, gold, k)`;
* `recall_at_k(ranked_chunks, spans, k)` = fraction of gold spans covered by the top-k chunks;
* `mrr`;
* `ndcg_at_k`: DCG = Σ 1/log2(i+1) for gold hits in the top k; ideal over `min(k, |gold|)`;
* `percentile(vals, p)`: linear interpolation.

**runner.py**, `evaluate(doc, questions, pipelines, k=5, judge=None, generate_answers=True, progress=None)`:
* judge default `{"component": "heuristic", "params": {}}`;
* for each question (closure binds `q` as a default argument), run all pipelines concurrently on a deep copy. If
  `generate_answers` is false, disable generation;
* `ranked_ids` = hits followed by dropped hits sorted by `ranks["retrieval"]` (default 999);
* `has_gold = spans and category not in {unanswerable, ambiguous} and not result.not_ready`;
* row:
  * `{question_id, category, pane, pipeline, question, answer, error, retrieved, gold_chunks, cited, latency_ms
    (total_ms), tokens_in, tokens_out, cost_usd, timings, not_ready: missing list or None, answer_source: kind or "llm"}`;
  * plus, if has_gold, `hit@k, recall@k (4 dp), mrr (4 dp), ndcg@k (4 dp)`;
  * plus the judge result if generating, with no error and ready (a judge exception gives `{"error"}`);
* emit `progress {done, total, row}`.

Summary leaderboard per pane:
* the means of `hit@k, recall@k, mrr, ndcg@k, correctness, faithfulness, citation_accuracy` (ignoring None, 4 dp);
* `abstention_acc`, `latency_p50`, `latency_p95` (1 dp), `tokens_in`, `tokens_out`, `cost_usd`, `errors`,
  `not_ready`, `fallback_answers`, `n`, `pane`, `pipeline`, `color`.

`by_category[cat][pane]` = `{n, metrics…, correctness}`. The leaderboard is sorted by
`−(recall + mrr + correctness/5)`. Output: `{id: uuid hex[:10], doc_id, k, created, duration_s, judge, rubric,
pipelines, rows, leaderboard, by_category}`, saved with `storage.evals.put(id, out)`.

---------------------------------------------------------------------------------------------------------------------

## 20. HTTP API (all under `/api`)

The routers live in `app/api/`. `api/__init__.py` builds `router = APIRouter(prefix="/api")` and includes, in order:
meta, documents, runs, questions (prefix `/questions`), qsets (prefix `/qsets`), evals.

`api/deps.py`:
* `doc_or_404(id)` raises 404 `"document <id> not found"`;
* `stream_queue(producer)`: run `producer(put)` as a task, yield SSE `event: <ev>\ndata: <json default=str>\n\n` per put,
  send `": keepalive\n\n"` after 15 s idle, yield `fatal {message}` if the task raised, and cancel the task when the
  client disconnects. Response: `text/event-stream`, headers `Cache-Control: no-cache`, `X-Accel-Buffering: no`;
* `stream_job(job)`: emit `progress` events from `job(progress)`, then one `result` event with its return value.

| method & path | request | response |
|---|---|---|
| GET `/health` | – | `{"ok": true}` |
| GET `/status` | – | `{ollama:{up, url, models[]}, suggest:{vector_stores:["default",…], embedding_models: EXAMPLES, llm_providers:["default",…]}}` (Ollama probe timeout 1.5 s) |
| GET `/components` | – | `{stages:[{stage, kind, components:[{name,label,description,schema}]}], kinds:{kind:[…]}, default_panes:[…]}` |
| GET `/categories` | – | categories without `instruction` |
| GET `/capabilities?refresh=bool` | – | §13 |
| GET `/vectorstore` | – | `{default, stores: stats()}` |
| GET `/settings` | – | `{settings, locks}` |
| PUT `/settings` | any subset of `{llm_provider, llm_model, embedding_model, vector_store, allow_llm, allow_embeddings}` | validates provider/store names (400), locked → **403**, else `{settings, locks}` and `vectorstore.forget()` |
| POST `/llm/{provider}/ping` | – | `{ok, detail}`; unknown → 404 |
| POST `/documents` | multipart `file` | doc_stats + `existed`; 400 unsupported type; 500 parse failure |
| GET `/documents` | – | list of doc_stats |
| GET `/documents/{id}` | – | doc_stats + `text` + `blocks` |
| GET `/documents/{id}/file` | – | original upload (glob `uploads/<safe_name(id)>.*`) or 404 |
| POST `/chunk/preview` | `{doc_id, chunking: StageConfig, tokenizer="tiktoken"}` | `{key, cache_hit, ms, stats:{count,avg,min,max,total}, chunks:[{id,start,end,tokens,page,heading_path}]}`; Unavailable → **409** "<reason>. Pick another chunker (heading-aware works without any model)." |
| POST `/run` | `{doc_id, question, pipelines: PipelineConfig[], save_history=true}` | SSE (§15). Empty question → 400. History id = `f"{int(ms)}-{uuid hex[:4]}"`, record `{id, ts, doc_id, doc_name, question, pipelines, results}` |
| GET `/history?limit=50` | – | `[{id, ts, question, doc_name, doc_id, panes:[names]}]` |
| GET `/history/{hid}` | – | the record or 404 |
| DELETE `/history` | – | `{ok}` |
| GET `/presets` | – | built-ins `{name: "Default · <pane name>", builtin: true, pipeline}` + saved (oldest first, `builtin: false`) |
| POST `/presets` | `{name, pipeline}` | `{ok}` (key = name) |
| DELETE `/presets/{name}` | – | `{ok}` |
| POST `/questions/generate` | `{doc_id, categories:{id:n}, mode="llm"\|"heuristic", llm?:{provider, model}, seed=7}` | SSE `progress` … `result {items}` |
| POST `/questions/analyze` | `{doc_id, items, chunking?, embedding_model?}` | §18 result (runs in a thread); errors → 400 |
| POST `/questions/validate` | `{doc_id, item}` | revalidated item |
| GET `/qsets?doc_id=` / POST `/qsets` | `{name, doc_id, items}` | list / `{ok}` (key `"<doc_id>-<name>"`) |
| POST `/eval` | `{doc_id, questions, pipelines, k=5 [1,50], judge?, generate_answers=true}` | SSE `progress {done,total,row}` … `result` |
| GET `/evals` | – | the last 30: `{id, created, n, k, pipelines:[names]}` |
| GET `/evals/{eid}` | – | the record or 404 |

## 21. App factory and startup

`app/main.py`, `create_app()`:
1. `config.setup_logging()`, `settings.apply_process_env()`, `discover()`.
2. A lifespan that calls `startup.run()`.
3. `FastAPI(title="RAG Lab", version="1.0.0")` with `CORSMiddleware(allow_origins=config.CORS_ORIGINS, allow_methods
   ["*"], allow_headers ["*"])`; include the router.
4. `_mount_frontend(app)`: only if `FRONTEND_DIST/index.html` exists. Mount `/assets` with StaticFiles. Add a
   catch-all `GET /{path:path}` (excluded from the schema) that:
   * raises **404 for `api` or paths starting with `api/`**;
   * serves an existing file inside dist (checking the resolved path is inside dist);
   * else serves index.html (SPA fallback).

`app = create_app()` at module level.

`app/startup.py`, `run()`:
* ingest `SAMPLE_DOC` with `parse_upload` (log exceptions);
* if `config.WARMUP`, start a daemon thread `warm_up(sample)`:
  * log the mode line `"mode: llm=%s embeddings=%s · llm=%s · vector_store=%s · embedding=%s"`;
  * if embeddings are disallowed, log and return;
  * `emb.ready()`, else log a warning and return;
  * `emb.embed_query("warm up")`;
  * load the cross-encoder `cross-encoder/ms-marco-MiniLM-L-6-v2` if `models.status` is ok;
  * `vectorstore.check(store)`: if ok and a sample exists, `get_chunkset(sample, DEFAULT_CHUNKING)` and `ensure(...)`,
    then log `"<store> collection <name>: <n> vectors"`; otherwise warn;
  * log "models warm". Exceptions are logged.

Logger names: `rag_lab.startup`, `rag_lab.api`.

---------------------------------------------------------------------------------------------------------------------

## 22. Frontend architecture

**Entry and setup:**
* `main.tsx`: `QueryClient({defaultOptions:{queries:{refetchOnWindowFocus:false, retry:1}}})`, `StrictMode`, and
  imports `index.css`.
* `index.html`: `<html lang="en">` (no `dark` class by default), title "RAG Lab", and Google Fonts Inter (400–700) and
  JetBrains Mono (400–600) links.
* `vite.config.ts`:
  * plugin react; alias `@` → `path.resolve(import.meta.dirname, 'src')` (do NOT use `__dirname`);
  * dev server port 5173, host 127.0.0.1, proxy `/api` → `http://127.0.0.1:8765` (changeOrigin);
  * `build.rolldownOptions.output.codeSplitting.groups`:
    * `react` → `/node_modules[\\/](react|react-dom|scheduler)[\\/]/`;
    * `ui-vendor` → `@radix-ui|framer-motion|motion-dom|motion-utils|lucide-react|react-resizable-panels`;
    * `data-vendor` → `@tanstack|zustand`.

  The build MUST finish with no warnings, with the main app chunk ≈ 116 kB.
* `tsconfig.app.json`: target es2023, moduleResolution bundler, jsx react-jsx, `paths {"@/*": ["./src/*"]}` (no
  `baseUrl`), `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, include `src`. `tsconfig.json` has only
  references.
* `package.json` scripts:
  * `dev`: `vite`
  * `typecheck`: `tsc --noEmit -p tsconfig.app.json`
  * `lint`: `oxlint src`
  * `build`: `tsc -b && vite build`
  * `preview`: `vite preview`
  * `check`: `npm run typecheck && npm run lint`

  name `rag-lab-frontend`, version `1.0.0`.

### 22.1 Types (`lib/types.ts`)
* `StageName` union (the 8 stages). `STAGES` array in pipeline order.
* `STAGE_LABEL = {query_transform:'Query', chunking:'Chunk', retrieval:'Retrieve', fusion:'Fuse', rerank:'Rerank',
  context_filter:'Filter', prompt:'Prompt', generation:'Generate'}`.
* `PaneId 'A'|'B'|'C'`, `PANE_IDS`.
* `StageConfig`, `PipelineConfig`, `JSONSchema` (incl. `'x-widget'`, `'x-suggest'`, `'x-options'`, `examples`,
  `anyOf`, `$ref`), `ComponentInfo`, `Registry {stages, kinds, default_panes}`, `DocStats`, `Block`, `Chunk`, `Hit`.
* `StageState {stage, status: pending|running|ok|skipped|error|not_ready, ms?, count_in?, count_out?, component?,
  reason?, error?, trace?}`.
* `RunResult` (all §15 result fields incl. `not_ready?: Readiness`, `notices?`, `answer_source?`).
* `PaneRun {status: idle|running|done|error, token, stages, answer, result?, error?, configHash?, question?,
  startedAt?}`.
* `QItem {id, category, question, expected_answer, gold_spans[{start,end,page,heading_path,quote,match}], difficulty,
  what_it_stresses, notes, source?, valid?, invalid_quotes?, analysis?: QAnalysis}`.
* `Category`, `ReadinessCheck`, `Readiness`, `ProviderRow`, `StoreRow`, `AppSettings`, `Capabilities`, `QTarget`,
  `QTerm`, `QAnalysis`, `QSuggestionGroup`, `QInsights {suggestions, context, signature}`.

### 22.2 API client (`api/client.ts`) and hooks (`api/hooks.ts`)
* `errorMessage(r)`: FastAPI `detail` (a string or JSON-stringified) else `"<status> <statusText>"`.
* `api(path, init)` sets JSON Content-Type when the body is not FormData and throws `Error(errorMessage)` if not ok.
  Also `post(path, body?)`, `put(path, body)`, `del(path)`.
* `sse(path, body, onEvent, signal?)`: POST with Accept `text/event-stream`, read the stream, split on blank lines, and
  parse `event:` / `data:` lines (JSON).
* Hooks (TanStack Query):
  * `useStatus` key `['status']`, refetch every 15 s;
  * `useCapabilities` key `['capabilities']`, refetch every **10 s**;
  * `useRegistry` key `['components']`, `staleTime: Infinity`;
  * `useDocs`, `useDoc(id)`, `useCategories`;
  * `useSuggestions()` returns `{ollama_models: status.ollama.models, ...status.suggest}`.

### 22.3 Stores
**`store/app.ts`** (zustand + `persist`, name `'rag-lab'`, **version 3**).

State:
* theme (default `'light'`), registry, docId, question, paneCount (1|2|3, default 3), panes, runs, sync, autoRun;
* maximized, bottomTab (`compare|qgen|eval|document`), bottomOpen, focus, docFocus;
* openDrawer per pane, paneTab per pane (`results|trace|prompt`), showDropped, historyOpen, settingsOpen,
  lastHistoryId.

Persisted (partialize): theme, docId, question, paneCount, panes, sync, autoRun, bottomTab, bottomOpen, showDropped.

Migrations:
* v<2: for every pane whose retrieval component is `dense`, set rerank `{enabled:true, component:'cross_encoder'}`;
* v<3: `theme = 'light'`.

Logic:
* `PANE_META` colours: A indigo, B emerald, C amber.
* `freshPanes(reg)` clones the registry default_panes with the pane id and colour.
* On `setRegistry`, keep the persisted panes if they look valid, else seed defaults.
* **Sync:** `mutate(pane, path, fn)` applies a change to every visible pane when sync is on, except `LOCKED` paths:
  `retrieval.component`, `retrieval.enabled`, `fusion.enabled`, `fusion.component`.
* `setStageComponent` keeps the params that exist in the new component's schema and enables the stage. `setParam` only
  applies to panes using the same component.

Actions:
* `applyLlmToAll(provider, model)` sets every pane's generation component (keeping params when the provider is
  unchanged), sets or deletes `model`, and enables generation.
* `followDefaultRetrieval()` removes `embedding_model` and `vector_store` from the params of dense/hybrid panes.
  **Do not name any store action with a `use` prefix** (lint treats it as a hook).
* `duplicatePane`, `replacePane`, `resetPanes`, `applyChunkingToAll`, `focusChunk` (pane + chunk + nonce → switch to
  results, scroll and flash), `showInDoc` (open the Document tab, focusing the chunk).
* `runPanes(ids?, opts?)`:
  * abort the previous controllers;
  * mark the targets running with all stages pending, increment `token`, and record `configHash` and question;
  * call `sse('/api/run', {doc_id, question, pipelines, save_history: opts.saveHistory ?? all})` and route the events by
    `pane` (ignore stale tokens): `stage_start`/`stage_end` update stages; `token` appends to the answer; `error` sets
    the error; `done` sets the status (error if `d.error`), `result` and answer; `history` sets `lastHistoryId`;
    `fatal` marks the targets errored.
* `loadHistoryRun(rec)` restores the panes, runs (status done), question and doc.
* `visiblePanes(s)` MUST return a **stable array reference** from a constant map `VIS = {1:['A'], 2:['A','B'],
  3:['A','B','C']}`. Returning a new array causes a "Maximum update depth" loop in zustand v5.

**`store/qset.ts`** (persist name `'rag-lab-qsets'`, partialize `byDoc` + `insights`):
* `byDoc: {docId: QItem[]}`, `set/add/update/remove`;
* `evalResult` + `setEval` (not persisted);
* `insights: {docId: QInsights}` + `setInsights`;
* `toCSV(items)` columns `id, category, question, expected_answer, difficulty, what_it_stresses, notes, gold_quotes
  (joined " || "), tests, why, bm25_rank, semantic_rank, hybrid_rank`;
* `parseCSV` (quoted-field parser), `download(name, content, type)`.

### 22.4 Utilities
* `lib/utils.ts`:
  * `cn` (clsx + tailwind-merge), `stableStringify`, `hashConfig(pipeline)`, `findComponent(reg, stage, name)`;
  * `schemaDefaults`, `effectiveParams` (defaults overlaid by explicit params), `queryTerms(q)` (stopword-filtered
    terms for highlighting);
  * `fmtMs`, `fmtScore`, `locationLabel`, `deepClone` (structuredClone), `isMac`, `modKey` ('⌘' or 'Ctrl').
* `lib/diff.ts`: `computeDiff(reg, panes, visible, pane)` → per stage `{enabled?, component?, params:{key: tooltip}}`
  plus `_count`. It compares effective params with each other visible pane (tooltip lines `"Pane B: value"`) and powers
  the **≠ badges**.
* `lib/highlight.tsx`: `highlight(text, terms)` wraps matches in `<mark className="qt">`. Inline markdown-lite: bold and
  code.
* `lib/questionAnalysis.ts`:
  * `TARGET_STYLE` (colour classes per target: semantic → paneB, bm25 → paneA, hybrid → paneC, hard → bad,
    baseline → neutral, reasoning → accent, abstention → warn; short labels Semantic, BM25, Hybrid, Hard, Baseline,
    Reasoning, Abstain);
  * `useQuestionAnalysis(docId, items)`:
    * signature = per item `id|category|question|gold span offsets`;
    * debounce 700 ms; re-run when the signature differs from the stored insights or any item lacks `analysis`;
    * POST `/api/questions/analyze` with the chunking stage and `embedding_model` of the **first pane among B, C, A
      whose retrieval is dense/hybrid** (else A), sending items without `analysis`;
    * write `analysis` into each item and set insights with `chunker: "<component> (<pane name> pane)"`;
    * returns `{insights, busy, err, rerun}`.

### 22.5 Layout and components
**`App.tsx`** (column, full height):
1. `TopBar`.
2. `QuestionBar`.
3. Main area: if `bottomOpen`, a vertical `Group` with `Panel id="panes" defaultSize="60" minSize="25"` (PaneArea), a
   `Separator`, and `Panel id="bottom" defaultSize="40" minSize="15"` (Bottom); else PaneArea plus a collapsed Bottom.
4. `Footer`.
5. `SettingsDialog`.

Other rules:
* Show "Backend not reachable" on a registry error, and "Loading components…" until the registry loads.
* Auto-select the first document if the persisted doc is missing.
* Toggle the `dark` class on `<html>` from theme.
* The bottom tabs (Compare, Question Generator, Batch Eval, Document view) are loaded with **`React.lazy`** inside
  `Suspense` (fallback: spinner "Loading…").

**Keyboard shortcuts** (global `useShortcuts`, the ONLY Ctrl/⌘+Enter handler; the question textarea MUST NOT have its
own, or runs fire twice):
* Ctrl/⌘+Enter runs all panes;
* Ctrl/⌘+1/2/3 sets the pane count;
* Ctrl/⌘+B toggles the bottom panel;
* Esc un-maximises and closes drawers;
* `/` focuses `#question-input` (when not typing).

**TopBar** (brand-blue band `h-14 bg-brand text-white`):
* "RAG Lab" (19px bold) + italic serif subtitle "find the right answer, side by side" (hidden below xl) + divider;
* document `Select` (white pill) with hint `"<KIND> · <tokens> tokens"`;
* Upload button (variant `onBrand`; accepts `.md,.markdown,.pdf,.txt`; POST `/api/documents`, then invalidate docs and
  select the new doc; errors shown);
* doc stats (2xl+): pages (PDF), tokens, headings, chunks;
* right side: `ModeChip`, gear button (`aria-label="Settings"`) opening Settings, "Presets" (resets panes), pane-count
  Segmented (1/2/3 icons; the active segment is white with brand text on the band), Sync switch (tooltip "Sync
  settings: a change applies to every pane, except the retrieval type and fusion (locked)"), theme toggle.

**ModeChip:**
* labels by mode: full "All systems on" (green dot); no_llm "No-LLM mode"; no_embeddings "No-embeddings mode"; offline
  "Offline mode" (amber dot);
* followed by `· <LLM label> · <vector store>`;
* tooltip lists LLM, embeddings and vector DB; click opens Settings.

**QuestionBar** (continues the blue band, `bg-brand px-4 pb-3 pt-1`):
* white pill textarea (`rounded-[24px]`, auto-grows to 140 px, id `question-input`, placeholder "Ask the style guide
  anything…" or "Upload or choose a document first");
* a "Run all" button (variant onBrand, h-44px) with a `Ctrl↵` kbd and a blue circle containing an ArrowRight icon
  (spinner while running);
* Auto-run switch (tooltip "Auto-run: config changes re-run the affected pane (600 ms debounce)") and a History
  popover (the last runs from `/api/history`, click to load, Clear button, shortcut legend);
* example question chips when the question is empty: the 5 strings in Appendix C.

**PaneArea:** a horizontal `Group` keyed by the shown panes (the maximised one only, if set), with the background
`linear-gradient(rgb(var(--brand)) 0, rgb(var(--brand)) 40px, transparent 40px)` so the pane cards overlap the band,
`px-3 pb-2`. Separators `mx-1 my-6 w-[4px] rounded-full`, transparent with brand on hover. **Auto-run:** subscribe to
the store; when autoRun and a question exist, re-run a visible pane 600 ms after its config hash changes (no history).

**Pane** (a card: `rounded-xl border bg-surface shadow-card overflow-hidden`):
* a 4px top bar in the pane colour;
* header: a circular pane-letter badge, the name (double-click to rename), a "≠ N" warn badge (settings that differ),
  an "outdated" badge when config or question changed since the run, a run button, a menu (Duplicate into pane X, Load
  preset list, Save as preset…, Export JSON, Import JSON), and maximise/restore;
* `FlowStrip`;
* **one scroll container** (`min-h-0 flex-1 overflow-y-auto`) holding the ConfigDrawer (natural height), a **sticky**
  Tabs bar (Results / Trace / Prompt, plus a "dropped" toggle on Results) and the tab content. Clicking any tab closes
  the drawer. Opening a drawer scrolls to the top; switching tabs scrolls to the top;
* Results:
  * idle → empty state "Ready when you are";
  * not ready → `ReadinessCard`;
  * else AnswerCard, a "Context N chunks of M · K cited" line, ChunkCards, and with "dropped" on, a "Retrieved but
    dropped · N" list. "Retrieval is off: closed-book baseline, no context." when retrieval was skipped.

**FlowStrip:**
* 8 stage nodes (`flex-1 basis-0 min-w-[54px]`), each showing a status dot (error red, not_ready amber, running pane
  colour, skipped/disabled grey, ok green), the stage label, ≠ if different, the component label, ms and count;
* disabled nodes are dashed and struck through; not_ready nodes have an amber border;
* a ⏻ toggle appears on hover; click toggles the ConfigDrawer; a tooltip shows the details.

**ConfigDrawer:**
* enabled Switch, stage label, diff badge, "sync" / "locked" badge, ms, close;
* help text per stage (Appendix A);
* a component Select with descriptions, then the description;
* `SchemaForm` (dimmed when disabled);
* "Last run output" with error, reason and a JSON tree of the trace.

**SchemaForm widget rules** (a grid, 1 column; 2 columns at container `@md`):
* `x-options` and a suggestion list → Select (option `default` labelled "default (⚙ Settings)");
* `enum` → Segmented if ≤ 4 options and every label ≤ 12 characters, else Select (labels strip `local:` and
  `sentence-transformers/`);
* boolean → row with Switch;
* number/integer with min and max → Slider + numeric input (step: integer 1; range ≤ 1 → 0.01; ≤ 10 → 0.05; else 0.5);
* number without range → numeric input;
* `x-widget: textarea` → textarea spanning 2 columns;
* string → text input with a datalist from `x-suggest` (suggestions) or `examples`;
* every field: label with a description tooltip, diff badge, and a reset icon when explicitly set and different from
  the default.

**AnswerCard:**
* header "Answer" + badges:
  * closed-book (warn);
  * **"no-LLM answer"** (accent, tooltip "<wanted> could not be used: <reason>" / "So the answer quotes the
    best-matching sentences from the retrieved chunks, with citations. No model was called.");
  * "streaming" indicator;
* the answer renders citations via regex `/\[([^\]]*?C\d+[^\]]*?)\]/g`: each id becomes a chip button (pane colour) that
  focuses the chunk. Ids not in the context are red, struck through, with tooltip "<id> was not in the context
  (hallucinated citation)". `**bold**` is supported;
* a notices strip (stage name + message);
* footer: a per-stage timing bar, per-stage ms, in/out tokens, `$cost` (4 decimals);
* "Generation is off: a retrieval-only run. Inspect the chunks below." when generation is disabled;
* `ErrorCard` variants: "Missing API key", "Local model unavailable" (Ollama) and "Stage failed", with a help line.
* Returns nothing when the pane is not ready.

**ChunkCard:**
* rank badge (#n, or – when dropped), chunk id, location (heading path / page), tokens;
* score chips `BM25 / cos / fused / rerank` (tooltips "BM25 keyword score (unbounded)", "Dense cosine similarity
  (−1…1)", "Fusion score (RRF or weighted)", "Reranker score") with ranks;
* rank movement after rerank (↑/↓ from retrieval rank);
* "cited" badge (pane border when cited), drop reason ("dropped by <stage>: <reason>"), the text with query-term
  highlights;
* "Show in document" button, "used in answer";
* dashed and 50% opacity when dropped; flashes when focused.

**TraceView** (one collapsible row per stage with status and ms) lines, verbatim:
* `Skipped: <reason>`;
* `Lexical queries: “q” · …` and `Dense queries: …` (when they differ);
* `<n> chunks · avg <a> tok · max <m> tok · cache hit|miss (<key>)`;
* `<list>: <n> candidates → C1, C2…` (first 8);
* `Index cache: bm25 hit|built, …`;
* `Vector DB: Chroma collection <c> · <n> vectors · reused|built now` (else `Vector search: in-memory NumPy · <n>
  vectors`);
* `Fused order: …`;
* `Reranked: C3(#4→#1), …`;
* `Kept: … · <n> context tokens`, `Dropped <id>: <reason>`;
* `<n> prompt tokens[ · closed-book]`;
* `<provider> · <model> · in X / out Y tok`;
* plus a JSON view.

**PromptView:** the system and user prompts in monospace, with a copy button.

**ReadinessCard:**
* amber-bordered card: PlugZap icon, headline, quip in italics with curly quotes;
* "Pre-flight check" label, a green progress bar `ok_count/total`, "N/M ready";
* the checks list: icon by state (ok CheckCircle2 green, missing CircleSlash amber, pending CircleDashed grey,
  fallback Info accent), label, uppercase state word (ready/missing/pending/fallback), detail, and for missing checks
  the fix in accent with a Wrench icon;
* footer: an "Open settings" button + "Everything else on this pane is set up. Once the missing piece is there, just
  run again."

**Bottom panel:** a card (`mx-3 mb-1 rounded-xl border shadow-card`). The tab bar is **navy** (`bg-navy`, white/70
text, active white with a white underline) with a collapse chevron.

* **Compare tab** (cards titled with the `.label-box` style):
  * "All answers side by side": per pane name, retrieval label, total ms, answer (or the error, or "Not ready yet:
    waiting for an embedding model / a vector DB.", plus a "no-LLM answer (extractive)" note), and "used:" chips (filled
    when cited);
  * "Retrieved-chunk overlap": a Venn of the final chunk sets and a Jaccard matrix;
  * "Chunk × pane matrix (rank in each pane's final context)";
  * "Side-by-side metrics": rows Retrieval, Chunker, Rerank, Model, Context chunks, Context tokens, Cited (valid +
    invalid count), Abstained, Latency, Generation;
  * "Answer diff (word-level)": an LCS word diff between two panes.
* **Question Generator tab:** left sidebar (330 px), then the table.
  * Sidebar:
    * "Generator" with Segmented LLM/Templates; in LLM mode an `LlmPicker` (provider Select incl. "Default
      (<provider>)" and providers with readiness hints, a model input with a datalist of Ollama models or examples, and
      a readiness line);
    * the "Generate N questions" button, progress bar, errors, and an LLM-mode hint;
    * the category list: label (click filters), count in the set, −/+ count stepper (0–10, default 1), explain text,
      "stresses: …".
  * Toolbar: filter input, category badge, a **"Tests" Select** (All tests / Tests: <short>), `shown / total`, Add,
    Import (JSON or CSV, each item re-validated), JSON/CSV export, Delete all.
  * Above the table, the `SuggestionsPanel` card:
    * label-box "Which question tests what" (collapsible), target count pills, "measured on N chunks · <chunker> ·
      <embedding model | semantic not measured>", a "Re-analyse" button;
    * advice lines (Target icon), the warning "Semantic ranks weren't measured (...). Verdicts marked ~ use BM25 ranks
      and wording only." when applicable;
    * a grid of group cards (dot, title, hint, items with a ▶ run button and the question text + `B#x S#y H#z`; clicking
      the text expands and scrolls to that row).
  * Table columns: [chevron, ▶], Category (+ stresses), **Tests** (TargetPill + `B #x S #y H #z` coloured by rank:
    ≤2 good, ≤5 warn, else bad; "~" for estimated, ⚠ for mismatch), Question (inline edit), Expected answer (inline
    edit), Gold (✓/⚠ count with a tooltip listing quotes and matches), Diff. (select), hover actions (re-validate,
    delete).
  * The expanded row shows the **WhyPanel** (2 columns):
    * left: TargetPill + headline, the mismatch warning box, "Why it's a test of <tests>" bullet list, and an "If it
      fails:" box;
    * right: "How the question's words exist in the document" term chips coloured by status, with tooltips (count,
      chunks, IDF, variants, also-in);
    * "The answer passage says, and the question didn't:" gap chips, and a legend;
    * "Where each retriever ranks the answer": bars for BM25/Semantic/Hybrid (`#r of n` or "not measured"), answer
      chunk(s) and sections, and "BM25's top hit instead: <chunk> (<section>)" when relevant.
* **Batch Eval tab:**
  * sidebar: category filter chips, k Segmented 3/5/10, "Generate + judge answers" switch, Judge Segmented
    Heuristic/LLM (+ LlmPicker), "View rubric", the "Evaluate N configs" button with progress, and a hint;
  * results: Leaderboard columns Config, Hit@k, Recall@k, MRR, nDCG@k, Correct, Faithful, Cite acc, Abstain, p50, p95,
    Tokens (best per column highlighted), CSV/JSON export;
  * a per-category bar chart with a metric Segmented (Recall@k / Hit@k / MRR / Correctness);
  * a per-question table (category filter, ▶ re-run in panes, cells with tooltips: retrieved ids, judge rationale,
    answer).
* **Document view:**
  * chunking preview using the selected pane's chunking config through SchemaForm, debounced POST
    `/api/chunk/preview`;
  * stats, size histogram, "Apply to pane X" / "Apply to all panes";
  * banded document text (alternating chunk bands, overlap stripes via `.band-stripe`, hover highlight, focus outline
    for "Show in document"), and a bands toggle.

**SettingsDialog** (Radix Dialog, `max-w 760px`, rounded-2xl):
* a brand-blue header: "Models, vector DB & access", mode badge, "Re-check connections" (GET
  `/api/capabilities?refresh=true`), close;
* sections with brand uppercase titles:
  1. "What this machine may call": two PolicyRows ("LLM calls" / "Answers, query rewriting, LLM reranker, question
     generator, LLM judge"; "Embedding / reranker models" / "Semantic & hybrid search, cross-encoder and MMR rerankers,
     semantic chunker"), each with allowed/off text, a Switch (disabled + Lock icon with tooltip "Locked off by <lock>.
     Change it there if your policy allows." when locked). Toggling PUTs `/api/settings` immediately.
  2. "Default LLM": a 2-column grid of provider cards (readiness dot, label, "ready · <default model>" / "no model:
     quotes the context" / the reason); a model input with suggestions; "Test connection" (POST
     `/api/llm/<p>/ping`, disabled when LLM calls are off, result ✓/✗); "Save as default" (PUT
     llm_provider/llm_model); "Apply to all panes" (store action).
  3. "Embeddings & vector database": an embedding model input (datalist from capabilities.embedders, readiness text),
     a vector DB Select (hint connected/reason), "Save as default", "Make all panes use these" (followDefaultRetrieval).
  4. "Connections": rows for every vector store and every model-using LLM (dot, kind, label + DEFAULT tag, detail incl.
     "needs: …").
* a message bar for results; after saving, refetch capabilities, status and components.

**Footer:** navy, h-7: "RAG Lab", a mode sentence ("LLM + embeddings on" / "No-LLM mode · answers are extractive" /
"Offline mode · BM25 + extractive answers" / "Embeddings off"), `LLM <provider>[ · model] · vector DB <store>`, and a
right-aligned shortcut legend.

---------------------------------------------------------------------------------------------------------------------

## 23. Theme (Citi-inspired). Exact tokens

`index.css` (Tailwind base/components/utilities). CSS variables are RGB triplets:

```css
:root {
  --bg: 242 245 250; --surface: 255 255 255; --elevated: 241 244 249; --line: 218 223 232;
  --fg: 15 22 50; --muted: 74 82 110; --subtle: 128 136 152;
  --accent: 37 91 227; --ring: 37 91 227; --brand: 37 91 227; --navy: 15 22 50; --overlay: 15 22 50;
  --pane-a: 37 91 227; --pane-b: 4 132 104; --pane-c: 205 102 0;
  --good: 4 132 90; --bad: 207 35 52; --warn: 176 110 0; --mark: 255 196 0;
  color-scheme: light;
}
.dark {
  --bg: 9 14 34; --surface: 15 22 50; --elevated: 22 31 66; --line: 40 52 96;
  --fg: 236 240 250; --muted: 170 180 208; --subtle: 116 126 160;
  --accent: 110 150 255; --ring: 110 150 255; --brand: 37 91 227; --navy: 6 10 26; --overlay: 0 0 0;
  --pane-a: 110 150 255; --pane-b: 40 190 150; --pane-c: 240 152 40;
  --good: 52 199 140; --bad: 250 100 110; --warn: 236 176 50; --mark: 220 170 30;
  color-scheme: dark;
}
```

Also in `index.css`:
* `html, body, #root {height:100%}`; body `bg-bg text-fg font-sans antialiased`; thin scrollbars;
* `mark.qt` (mark colour at 28% background, inset bottom line);
* `.num` (mono, tabular);
* `.band-stripe` (135° repeating stripe of fg at 14%);
* `.pane-A|B|C { --pc: var(--pane-a|b|c) }`, `.text-pc`, `.bg-pc`, `.bg-pc-soft` (10%), `.border-pc` (55%),
  `.ring-pc`;
* `.font-display-serif {font-family: Georgia, "Times New Roman", serif; font-style: italic}`;
* `.label-box` in **plain CSS** (not `@apply` with custom colours): inline-flex, `1px solid rgb(var(--brand))`, radius
  4px, padding 2px 8px, 10.5px, weight 600, letter-spacing .08em, uppercase, colour brand. `.dark .label-box` uses the
  accent.

`tailwind.config.js` (darkMode `'class'`; content `index.html` + `src/**/*.{ts,tsx}`; plugin container-queries):
* fontFamily: sans `"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif`; display `Georgia, "Times New
  Roman", serif`; mono `"JetBrains Mono", ui-monospace, …`;
* colors: bg, surface, elevated, line, fg, muted, subtle, accent, **brand**, **navy**, paneA/B/C, good, bad, warn, each
  as `rgb(var(--x) / <alpha-value>)`;
* boxShadow: `glow: '0 0 0 1px rgb(var(--line) / 0.9), 0 10px 40px 0 rgb(0 0 0 / 0.12)'`,
  `card: '0 10px 40px 0 rgb(0 0 0 / 0.10)'`;
* borderRadius: md 4px, lg 8px, xl 16px, 2xl 20px;
* keyframes and animations: `pulsering` (box-shadow ring in `--ring`, 1.2 s infinite), `shimmer`, `flash`
  (accent 28% → transparent, 1.6 s).

UI primitives (`components/ui/index.tsx`):
* **Button** (cva): base `rounded-full text-[13px] font-semibold`. Variants:
  * primary `bg-brand text-white shadow-[0_8px_24px_-10px_rgb(var(--brand)/0.9)]`;
  * **onBrand** `bg-white text-brand shadow-card`;
  * secondary `bg-surface text-brand border border-brand/40` (dark: accent);
  * ghost `rounded-md font-medium text-muted hover:bg-elevated`;
  * outline `border-brand/50 text-brand`;
  * danger.

  Sizes: sm h-7, md h-8, lg h-10, icon h-7 w-7, iconSm h-6 w-6.
* Switch (Radix; checked brand; supports `disabled`).
* Slider.
* Tooltip `Tip`.
* Select (Radix; trigger h-7 rounded-md; items with an optional hint line).
* Segmented (rounded-full container; active `bg-brand text-white`).
* Popover, Badge (tones neutral/accent/good/bad/warn/pane), Kbd, Skeleton, Empty, Tabs (active text brand with a 3px
  brand underline; dark uses accent).

Brand rules:
* do not use Citi logos or proprietary fonts;
* the app name stays "RAG Lab";
* pane colours stay blue/green/amber (distinguishable for colour-blind users).

---------------------------------------------------------------------------------------------------------------------

## 24. Backend tooling files

`backend/pyproject.toml`:
```toml
[project]
name = "rag-lab"
version = "1.0.0"
requires-python = ">=3.11"
[tool.ruff]
line-length = 120
target-version = "py311"
extend-exclude = [".venv"]
[tool.ruff.lint]
select = ["E","F","W","I","B","UP","SIM"]
ignore = ["E501","SIM105","B905","UP045","UP007"]
[tool.ruff.lint.per-file-ignores]
"tests/*" = ["B","SIM"]
"app/components/**/__init__.py" = ["F401"]
[tool.ruff.lint.isort]
known-first-party = ["app"]
[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-q"
filterwarnings = ["ignore::DeprecationWarning"]
```

Requirements files:
* `requirements.txt` (runtime): fastapi>=0.110, uvicorn[standard]>=0.29, pydantic>=2.6, python-multipart>=0.0.9,
  python-dotenv>=1.0, pymupdf>=1.24, markdown-it-py>=3.0, tiktoken>=0.7, rank-bm25>=0.2.2, numpy>=1.26,<2,
  httpx>=0.27, anthropic>=0.40, openai>=1.40, sentence-transformers>=3.0, chromadb>=1.0;
* `requirements-dev.txt`: `-r requirements.txt`, pytest>=8.0, ruff>=0.6, vulture>=2.11;
* `requirements-optional.txt`: faiss-cpu>=1.8, psycopg[binary]>=3.1, pinecone>=5.

**torch MUST be installed first from the CPU index**: `pip install torch --index-url
https://download.pytorch.org/whl/cpu`.

## 25. Run scripts, Makefile, container

`scripts/common.ps1` defines:
* `Start-OllamaIfInstalled`: probe `:11434/api/version`, else start `%LOCALAPPDATA%\Programs\Ollama\ollama.exe serve`
  hidden, else warn;
* `Initialize-Backend $root`: create `.venv` with CPU torch + requirements on first run, and return `python.exe`;
* `Initialize-Frontend $root`: `npm install` if `node_modules` is missing.

`scripts/common.sh` has the bash equivalents (`start_ollama_if_installed`, `init_backend` sets `$PY`, `init_frontend`).

Run scripts:
* `dev.ps1`: source common; set `WATCHFILES_FORCE_POLLING=true`; start uvicorn
  `-m uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload --reload-dir app --timeout-graceful-shutdown 3` in
  `backend`; then `npx vite --port 5173 --host 127.0.0.1` in `frontend`; stop the API when Vite exits. Banner
  `RAG Lab (dev) ->  http://127.0.0.1:5173`.
* `dev.sh`: same, backgrounding the API with `trap` kill on exit.
* `prod.ps1 [-Rebuild]` / `prod.sh [--rebuild]`: init; `npm run build` if `frontend/dist/index.html` is missing or
  rebuild was requested; host = env `RAG_LAB_HOST` or 127.0.0.1, port = `RAG_LAB_PORT` or 8765; run
  `uvicorn app.main:app --host H --port P --proxy-headers --timeout-graceful-shutdown 10` (no reload, **one worker**:
  caches and SSE are in-process).

Makefile targets:
* `install` (venv, CPU torch, requirements-dev, npm install);
* `dev` (./dev.sh), `build` (npm run build), `prod: build` (./prod.sh);
* `test` (pytest), `lint` (ruff check app tests; npm run lint), `typecheck`, `check: lint typecheck test`;
* `clean` (dist, caches, `__pycache__`).

`PY := backend/.venv/bin/python` if it exists, else `backend/.venv/Scripts/python`.

`Dockerfile`:
* stage `ui`: node:22-slim, `npm ci`, `npm run build`;
* stage 2: python:3.11-slim, env `PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
  RAG_LAB_DATA=/app/data RAG_LAB_FRONTEND_DIST=/app/frontend/dist`, workdir `/app/backend`;
* install CPU torch then requirements; copy `backend/app`, `samples` → `/app/samples`, dist → `/app/frontend/dist`;
* non-root user `raglab` owning `/app/data`;
* `EXPOSE 8765`; HEALTHCHECK GET `/api/health`;
* CMD `python -m uvicorn app.main:app --host 0.0.0.0 --port 8765 --proxy-headers --timeout-graceful-shutdown 10`.

`.dockerignore`: `.env`, `data/`, `__pycache__`, caches, `backend/.venv/`, `backend/tests/`,
`frontend/node_modules/`, `frontend/dist/`, `.vscode/`, `*.md`.

---------------------------------------------------------------------------------------------------------------------

## 26. Tests (backend/tests). All MUST pass: 49 passed, 1 skipped (the pgvector live test without a DSN)

`conftest.py` MUST set the environment **before importing app modules**:
`os.environ.setdefault("RAG_LAB_DATA", tempfile.mkdtemp(prefix="rag_lab_test_"))` and
`os.environ.setdefault("RAG_LAB_WARMUP", "false")`. Then `discover()`. Session fixtures:
* `doc` = markdown parser on the sample, doc id "test";
* `tok` = tiktoken.

`helpers.py`:
* `Ctx(doc, tok)` stub;
* `chunkset(doc, tok)` = heading_aware 256 / overlap 0, key `"t-" + stable_hash(index_texts)`;
* `pipe(retriever, **stage_overrides)` = a default-like PipelineConfig with query_transform off, rerank off and
  generation ollama qwen2.5:1.5b;
* `run(doc, cfg, q)` → `(result, events)`.

Test modules import the helpers as `_Ctx, _cs, _pipe, _run`.

| file | tests (what they assert) |
|---|---|
| test_ingestion.py | the markdown parser keeps heading paths ("2.2 Numbers"); every chunker in {fixed_token, recursive, sentence, heading_aware, page} × sizes {(64,0),(128,16),(256,64)} keeps chunks ≤ size; fixed_token overlap is exact; zero overlap means no shared text; overlap is capped at half; heading_aware (512, overlap 0): within every chunk, all text before the last Markdown heading line is blank (earlier sections may only appear as bare, folded headings), and `index_text` starts with `" > ".join(heading_path)` |
| test_retrieval.py | BM25: an exact term ("Project Halcyon code name") ranks the Halcyon chunk first; RRF fusion maths; weighted alpha extremes (0 → BM25 winner, 1 → dense winner); dense paraphrase ("how do I describe pictures for blind users" → "alt text" in the top 3, scores descending); Chroma semantic search on 4 paraphrases returns the gold chunk first ("pictures for blind users"→"alt text", "ship the changelog"→"every second Tuesday", "warning before removing a feature"→"90 days", "readability ratio"→"4.5:1") |
| test_vector_stores.py | in_memory, chroma and faiss return identical rankings and scores (±1e-3) and persist (ensure again → cached; the Chroma record holds the documents and metadata start; stats lists the collection); pgvector equals in-memory (skipped unless `PGVECTOR_TEST_DSN`); Pinecone logic with a fake client (index auto-created with dim 384, same ranking, all vectors in the namespace) |
| test_policy_and_fallbacks.py | no-LLM mode: BM25 pane answers extractively with "Halcyon", cites, multi_query falls back (skipped), a generation notice is present, and no Ollama client is constructed; the policy guard blocks `complete()` for ollama/openai/anthropic/gemini while extractive stays ready; semantic and hybrid with embeddings+LLM off → not_ready with missing == ["embedder"], states chunks ok, vector_db ok, embedder missing, llm fallback (+ bm25 ok for hybrid), a quip, "embedding model" in the headline, stage_end retrieval not_ready and generation skipped; missing pgvector DSN → missing == ["vector_db"] with a fix; unconfigured gemini/azure/openai_compatible/pinecone mention their env vars; settings switch the defaults (gemini + model, faiss) and the env lock raises PermissionError; offline locks both |
| test_evaluation.py | metrics (hit/recall/mrr/ndcg incl. exact nDCG value, gold_chunk_ids); gold-span locate (exact/normalised/fuzzy); heuristic qgen covers all 16 categories with valid spans; question analysis: the "heads-up before a feature is removed" paraphrase → semantic with semantic rank ≤ 2 and BM25 rank ≥ 5; "joke" is a variant of "jokes"; "LMN-2207" → BM25 rank 1, identifier detected, "2207" is gold; unanswerable → abstention; the template paraphrase is flagged as a mismatch naming "contractions"; filler "say" is excluded; suggestion groups contain them; without embeddings → not measured, estimated, still semantic |
| test_api.py | health, components (default pane names BM25/Semantic/Hybrid RRF, vector_store kind), status suggest; a streamed BM25 run with LLM off → done answer has Halcyon + extractive_fallback, history saved and readable; path tricks (`safe_name` strips separators and `..`; `/api/history/..%2F..%2Fsettings` and `/api/evals/..%2F..%2Fsettings` → 404); presets round trip; settings: unknown store 400, locked allow_llm 403, capabilities mode no_llm/offline with the lock; SPA serving from a temp dist (index at `/`, deep link fallback, the asset served, `/api/health` still JSON, **`/api/no-such-route` → 404**) |

Lint MUST be clean: `ruff check app tests` → "All checks passed!". Frontend: `npm run typecheck` 0 errors,
`npm run lint` 0 errors (warnings about the set-state-in-effect pattern are acceptable), `npm run build` with no
warnings.

---------------------------------------------------------------------------------------------------------------------

## 27. Acceptance checklist (verify all)

1. `make check` (or the Windows equivalents in the README) passes; tests 49 passed, 1 skipped.
2. `./dev.ps1` → http://127.0.0.1:5173 shows the blue band UI and three panes; the sample guide is preselected.
3. Ask "Which code name must never appear in public documentation?" (Ctrl+Enter). Exactly **one** POST `/api/run`.
   All three panes stream answers mentioning "Project Halcyon" with citations; the Compare tab shows all answers.
4. The paraphrase benchmark (30 paraphrased questions, heading_aware 256, bge-small): Semantic hit@1 ≈ 0.87, hit@5 1.00,
   MRR ≈ 0.91; BM25 hit@1 ≈ 0.67; Semantic + cross-encoder hit@1 ≈ 0.90, MRR ≈ 0.95. Chroma results equal in-memory.
5. Settings → switch off both policy switches → BM25 shows a "no-LLM answer" quoting "Project Halcyon … [C17]";
   Semantic/Hybrid show the pre-flight card (Chroma connected, chunks ready, stored vectors, embedding model missing
   with a fix, LLM fallback) and a quip; Compare shows "Not ready yet: waiting for an embedding model." Restore the
   switches.
6. Settings → vector DB FAISS → Semantic runs with trace `vector_store=faiss`. pgvector without a DSN → the pre-flight
   card reports `PGVECTOR_DSN is not set in .env (...)`.
7. Question Generator → Templates → Generate 16 → every row gets a Tests badge; the suggestions card appears; expanding
   a row shows the WhyPanel; template "paraphrase" rows show the ⚠ mismatch.
8. Batch Eval → retrieval-only run finishes in seconds and shows the leaderboard and per-category chart.
9. `./prod.ps1` → http://127.0.0.1:8765 serves the UI and API; `/some/route` serves the UI; `/api/no-such` → 404.

---------------------------------------------------------------------------------------------------------------------

## 28. Known pitfalls (read before debugging)

* **Windows + uvicorn `--reload`:** uvicorn 0.54 restarts its worker on Windows by sending `CTRL_C_EVENT`. A server
  started without a console (e.g. from a background/non-interactive shell) never receives it and the reload hangs
  forever, leaving the old code serving. In a real terminal (`dev.ps1`) it works. When automating, run without
  `--reload` and restart explicitly. `WATCHFILES_FORCE_POLLING=true` is needed for file-change detection on Windows.
* **Text encoding on Windows:** write files with `encoding="utf-8"` and set `PYTHONUTF8=1` for scripts that print
  non-ASCII.
* **numpy MUST stay < 2** (chromadb, sentence-transformers and torch compatibility in this stack).
* **zustand v5 selectors** must return stable references (see `visiblePanes`).
* **react-resizable-panels v4** API differs from v2 (`Group`/`Panel`/`Separator`, `orientation`, string sizes).
* **Vite 8** uses rolldown: code splitting is configured with `build.rolldownOptions.output.codeSplitting.groups`, and
  `import.meta.dirname` replaces `__dirname`.
* **Tailwind v3 config changes** are not always picked up by a running Vite server; restart Vite after editing
  `tailwind.config.js`. Avoid `@apply` with custom colours in `index.css` (use plain CSS with variables).
* **FastAPI 0.162:** `app.routes` contains included-router wrappers without `.path`; list routes via
  `app.openapi()["paths"]`.
* **TestClient path normalisation:** a literal `../` in a URL is resolved client-side; use `%2F`-encoded traversal in
  tests.
* **The small model (`qwen2.5:1.5b`)** over-abstains if the prompt rules are phrased negatively or placed in the system
  prompt only, and copies example answers verbatim. Use the exact prompt construction in §10.11.
* **Chunk cache invalidation:** bump the chunker class `version` when its algorithm changes (heading_aware is version 2).
* **Ollama** must be running with the model pulled for LLM answers; without it, answers fall back to extractive quotes
  (by design, not an error).

---------------------------------------------------------------------------------------------------------------------

## Appendix A: verbatim UI and system strings

**Policy messages:** `LLM calls are switched off (no-LLM mode)` · `Embedding/reranker models are switched off`.

**Readiness quips** (`QUIPS`; keep the order, it determines the md5-based choice):

embedder:
1. "All the pipes are connected and the water's on. I'm just missing the tap. Plug in an embedding model and I'll start pouring answers."
2. "The library is open and the shelves are stocked, but my reading glasses are missing. Hand me an embedding model and I'll find anything."
3. "Engine checked, tyres checked, fuel checked… keys? Somewhere. Give me an embedding model and we're off."
4. "I can see the vector database from here and it waved back. I just need an embedding model to say something meaningful to it."

vector_db:
1. "I've got my reading glasses on, but nowhere to shelve the books. Connect a vector database and I'm in business."
2. "Embeddings: ready. Filing cabinet: nowhere to be found. Point me at a vector DB and I'll get organised."
3. "I know exactly what every chunk means. I just don't have a place to keep it yet. A vector DB, please?"

both:
1. "Stage is built, lights are rigged, and the band hasn't arrived yet. Bring an embedding model and a vector DB, and it's showtime."
2. "Everything that can be ready is ready. The rest is on its way, like a pizza with two toppings still in the oven."

**Judge rubric (`RUBRIC`):**
```
correctness (1-5): how well the answer matches the expected answer (5 = fully correct).
faithfulness (1-5): is every claim supported by the retrieved context? (5 = fully grounded)
citation_accuracy (0-1): fraction of cited chunks that actually contain the gold evidence.
abstention: for unanswerable/false-premise questions, did the system correctly decline or push back?
```
(The UI's "View rubric" tooltip shows a shorter 4-line paraphrase of this.)

**Config drawer stage help (`STAGE_HELP`):**
* query_transform: "Rewrites the question before retrieval. Off: the raw question is used."
* chunking: "How the document is split. Off: the whole document is one chunk (long-context baseline)."
* retrieval: "Finds candidate chunks. Off: closed-book baseline, so the LLM answers with no context."
* fusion: "Merges BM25 and dense lists (hybrid only). Off: the lists are interleaved round-robin."
* rerank: "Re-scores the retrieved chunks. Off: retrieval order is kept."
* context_filter: "Threshold, dedupe, neighbours, merge, token budget. Off: everything is kept."
* prompt: "Builds the final prompt. Off: bare context + question."
* generation: "The LLM call. Off: a retrieval-only run."

**Question-analysis FILLER words** (excluded from the terminology map):
`according about regarding say says said tell tells explain describe guide guide's guides document docs doc rule rules
policy advice dealing follow following what's whats which what when where how why who whom whose much many get got give
gives need needs want wants should would could might must may also please plain terms term mean means meaning thing
things way ways kind sort okay allowed allow there here this that these those does did done do make makes use used using
write writing written`

**Term status chips** (word / tooltip):
* gold: "in answer" / "Appears word-for-word in the answer passage: BM25 can match it."
* gold_section: "in answer chunk" / "In the answer's chunk or its heading, not in the quoted sentence itself."
* elsewhere: "elsewhere only" / "In the document, but NOT in the answer passage: it pulls keyword search towards other
  sections (a distractor)."
* variant: "other word form" (chip shows `→ <variant>`) / "Only appears as another form of the word. BM25 doesn't stem,
  so it misses this; embeddings see the link."
* absent: "not in doc" / "Never appears in the document: only semantic search can bridge this paraphrase."

## Appendix C: question-generation texts

**Category `explain` / `instruction` (in category order):**
* single_hop: "The answer sits in one chunk. It is the baseline: every strategy should get it." / "Ask a factual question answered by ONE sentence of the passage."
* multi_hop: "The answer needs facts from 2+ separate sections. Tests top_k, decomposition and context assembly." / "Ask ONE question whose answer requires combining a fact from passage A AND a fact from passage B."
* comparison: "Contrast two rules or concepts. Both sides must be retrieved." / "Ask a question that contrasts the rule in passage A with the rule in passage B."
* rule_application: "\"Rewrite this sentence according to the guide.\" The model must find the rule AND apply it. Key for style guides." / "Write a short example sentence that VIOLATES a rule in the passage, and ask to rewrite it according to the guide. The expected answer is the corrected sentence plus the rule."
* exception: "\"When does rule X not apply?\" Exceptions are often a single clause that coarse chunks dilute." / "Ask when a rule in the passage does NOT apply, or what its exception is."
* conflict: "Two rules seem to collide. Which one wins? Needs both rules plus reasoning." / "Describe a situation where the rule in passage A and the rule in passage B seem to conflict, and ask which takes precedence."
* exact_term: "A rare term, code or name. Lexical BM25 shines here; dense embeddings can blur rare tokens." / "Ask a question that uses a rare, specific term, name or code copied EXACTLY from the passage."
* paraphrase: "Same meaning, different words. BM25 misses it; semantic search should catch it." / "Ask about a rule in the passage using completely DIFFERENT vocabulary (synonyms, no key terms from the passage)."
* list_aggregation: "\"List all rules about X.\" Evidence is spread across sections, so it tests recall and top_k." / "Ask to list ALL the rules about a topic that appears in both passages."
* numerical: "Limits, counts and formats. Small details that must be quoted exactly." / "Ask about a specific number, limit, count or format stated in the passage."
* negation: "\"What should you NOT do…\" Embeddings often ignore negation." / "Ask what you should NOT do, or must avoid, according to the passage."
* unanswerable: "The answer is not in the document. The correct behaviour is \"I don't know\"." / "Ask a plausible question on the same general topic that the passage does NOT answer at all."
* false_premise: "The question assumes something the guide doesn't say. The model should push back." / "Ask a question that wrongly assumes the passage says the OPPOSITE of one of its rules."
* ambiguous: "Underspecified. A good answer asks for clarification or covers the interpretations." / "Ask a vague, underspecified question that could match several rules in the passage."
* summarization: "Understanding a whole section. Needs many chunks, or large ones." / "Ask for a summary of the main guidance in the passage."
* multi_turn: "A follow-up that only makes sense with the previous turn. Generated as a pair." / "Write a first question about the passage, then a short follow-up question that depends on it (e.g. uses 'that' or 'it')."

**Heuristic unanswerable questions:**
1. "What does the guide recommend for formatting SQL queries in documentation?"
2. "Which font size does the guide require for slide presentations?"
3. "What is the guide's policy on emoji usage in legal contracts?"
4. "How should video subtitles be timed according to the guide?"
5. "What does the guide say about writing in Klingon?"

**QuestionBar example chips:**
1. "Can I use exclamation marks in error messages?"
2. "What does the guide say about Project Halcyon?"
3. "How should I describe pictures for people using screen readers?"
4. "If a legal notice says \"Log in\", which rule wins?"
5. "What is the guide’s policy on writing SQL?"

## Appendix D: question-analysis texts (verbatim; `{x}` = substitution)

**Reasons, abstention target:**
1. "No passage in the document answers this, so every retriever will still return *something*. The real test is whether the answer says it doesn't know instead of inventing one."
2. (if any gold/distractor terms) "It reuses document words ({first 4 of gold terms + distractor terms}), so retrieval will look confident, which makes the trap more realistic."

**Reasons, other targets, in this order (each only when applicable):**
1. measured: "Measured on your chunks: BM25 puts the answer at #{b}, semantic search at #{d}{, hybrid RRF at #{h}} (of {n} chunks)." / estimated: "Measured on your chunks: BM25 puts the answer at #{b} of {n}. Semantic rank isn't measured while embeddings are off."
2. "Shared wording with the answer passage: {first 6 gold terms} ({int(overlap*100)}% of the question's term weight)." or "The question shares no content words with the answer passage, so keyword search has nothing to latch on to."
3. "{first 4 absent terms} never appear in the document. Only meaning (embeddings) can connect them to the answer."
4. per variant (max 2): "'{term}' only appears as {variants}. BM25 doesn't stem, so it won't count that as a match. Semantic search will."
5. "The passage itself says {first 4 gap terms}: words the question avoided."
6. first distractor term (elsewhere, ≥2 chunks): "'{term}' appears in {chunks} other chunks{ (e.g. {first 2 also_in})}, a keyword distractor."
7. "BM25's top hit is {chunk} ({section}), not the answer." (only if it beats gold)
8. "Exact identifier(s) {ids}: rare literal strings are BM25's home ground."
9. "Contains a negation. Retrievers ignore 'not'/'never', so the answer step must get the polarity right."
10. "The answer spans {len(gold_sections) or 2} sections, so top_k and reranking decide whether both parts reach the prompt."
11. estimated with note: "Verdict estimated without a semantic rank ({note text after the first ': '})."

**Headlines:**
* bm25: "Good BM25 check: the exact words carry it" + (est ? " (BM25 #{b})" : " (#{b} vs semantic #{d})")
* semantic: "Good semantic-search check: it's about meaning, not shared words" + (est ? " (BM25 only #{b})" : " (#{d} vs BM25 #{b})")
* hybrid: "Good hybrid check: each method alone is weak, together they find it" + (h ? " (RRF #{h})" : "")
* hard: "Hard for every retriever: a stress test" + (est ? "" : " (BM25 #{b}, semantic #{d})")
* baseline: "Sanity baseline: every method should get this right" + (est and b ? " (BM25 #{b})" : "")
* reasoning: "Tests multi-chunk recall and the answer step"
* abstention: "Tests abstention: there is no right passage"

**If it fails:**
* bm25: "If the BM25 pane misses it, check tokenisation/stopwords or chunking. If semantic misses it, that's expected: rare literal terms are where embeddings are weakest (use hybrid)."
* semantic: "If the semantic pane misses it, the embedding model or chunk size is the problem. A BM25 miss is expected here; it's the reason hybrid exists."
* hybrid: "If hybrid misses it, tune the fusion (RRF k or alpha) or raise candidate_k for both retrievers."
* hard: "Try a query rewrite (multi-query / HyDE), a cross-encoder reranker, or smaller chunks, then re-run."
* baseline: "A miss here means something basic is broken (chunking, index, top_k). Investigate first."
* reasoning: "If parts of the answer are missing, raise top_k, add a reranker or check the context filter's token budget."
* abstention: "If a pane answers confidently, tighten the prompt's 'say I don't know' rule or add a similarity threshold."

**Category mismatch** (`{cat}` = category id with "_" → " "):
* intended semantic: "Labelled '{cat}', but it reuses the passage's own words{ ({first 4 gold terms})}, so keyword search finds it too and it won't separate semantic from BM25. Reword those terms with synonyms (or use LLM mode) to make it a real semantic test."
* intended bm25: "Labelled '{cat}', but BM25 doesn't rank the answer first (#{b}). Add the exact term, code or number from the passage to make it a real keyword test."
* otherwise: "Labelled '{cat}', but the measured behaviour looks like a {target label lowercased}."

**Advice:**
* "{n} question(s) don't test what their category promises (marked ⚠ in the table), e.g. 'paraphrase' questions that copy the section's words. Edit them or regenerate in LLM mode."
* "No question where semantic search beats BM25 yet. Generate more 'Paraphrased / lexical mismatch' or 'Negation' questions (LLM mode paraphrases best)."
* "No question where BM25 clearly wins. Add 'Exact-term lookup' or 'Numerical' questions (codes, numbers, product names)."
* "No hallucination traps. Add 'Unanswerable' or 'False premise' questions."
* "Most questions are easy for every method, so they won't separate your configs. Ask for more paraphrase, multi-hop and exception questions."

## Appendix B: `samples/style_guide_sample.md` (verbatim; save byte-for-byte)

The benchmark numbers and several tests depend on this exact text. It is a fictional guide ("Lumen Docs").

````markdown
# Lumen Docs Style Guide

Version 3.2. This guide applies to all public documentation, release notes, UI text, and help-center articles published by the Lumen documentation team. Internal engineering design docs are exempt unless they are shared with customers.

## 1. Voice and tone

### 1.1 Be direct

Write in the second person and address the reader as "you". Prefer the active voice: "Click **Save**" rather than "The Save button should be clicked". Lead with the action the reader needs to take, then explain why.

Passive voice is acceptable when the actor is unknown or unimportant, for example "The file is encrypted at rest." It is also acceptable in API reference descriptions of system behavior.

### 1.2 Be warm, not cute

Use a friendly, professional tone. Avoid jokes, puns, and pop-culture references, because they do not translate well and can age badly. Never use exclamation marks in error messages. In onboarding screens, a maximum of one exclamation mark per screen is allowed.

### 1.3 Inclusive language

Use gender-neutral language. Use "they" as a singular pronoun when the gender of a person is unknown. Avoid ableist terms such as "sanity check" (use "quick check" instead) and "crippled" (use "limited" or "disabled"). Replace "whitelist" and "blacklist" with "allowlist" and "denylist", and replace "master/slave" with "primary/replica".

## 2. Grammar and mechanics

### 2.1 Capitalization

Use sentence case for all headings, titles, buttons, and menu items: capitalize only the first word and proper nouns. For example, write "Create a new project", not "Create A New Project".

Exception: product names and feature names that are registered trademarks keep their official capitalization, such as "Lumen Vault" and "QuickSync".

### 2.2 Numbers

Spell out numbers from zero to nine and use numerals for 10 and above. Always use numerals for measurements, percentages, version numbers, and time, even below 10: "5 MB", "3%", "version 2", "4 minutes".

Do not start a sentence with a numeral; rewrite the sentence or spell the number out. Use commas as thousands separators in numbers of four or more digits, for example "1,024 files". Exception: do not use commas in years, port numbers, or error codes, such as "port 8080" or "error 4096".

### 2.3 Dates and times

Write dates in the format "March 7, 2025" in running text. In tables and logs, use the ISO 8601 format YYYY-MM-DD. Use the 12-hour clock with "a.m." and "p.m." in UI text, and always include the time zone, for example "3:00 p.m. UTC". Never use ambiguous formats such as 03/07/25.

### 2.4 Punctuation

Use the serial (Oxford) comma in lists of three or more items: "files, folders, and links". Use the em dash sparingly and without spaces. Do not use semicolons in UI text; split the sentence into two instead.

Put periods at the end of complete sentences in list items. If none of the list items is a complete sentence, omit the periods for all of them. Do not mix the two styles in one list.

### 2.5 Contractions

Contractions such as "don't", "you're", and "it's" are encouraged because they make the text sound natural. However, do not use contractions in legal notices, security warnings, or compliance documentation, where precision matters more than tone.

## 3. Formatting

### 3.1 Headings

Every page must have exactly one H1. Do not skip heading levels (for example, from H2 to H4). Headings must not end with a period. Keep headings under 60 characters.

### 3.2 Lists

Use numbered lists for sequential steps and bulleted lists for non-sequential items. A procedure should have no more than 7 steps; if it needs more, split it into sub-procedures. Each step should contain one action.

### 3.3 Code and UI elements

Format UI elements that the user clicks or selects in **bold**, for example: click **Settings** > **Billing**. Use the right angle bracket (>) with spaces to show menu paths.

Format code, commands, file names, paths, and environment variables in `monospace`. Never put UI labels in monospace. Code blocks must specify a language for syntax highlighting. Commands that the user should type must not include the shell prompt character ($) unless the output is shown in the same block.

### 3.4 Links

Use descriptive link text that tells the reader where the link goes. Never use "click here" or "read more" as link text. Do not link the same destination more than once per section. Links to external sites must open in the same tab, unless the reader is in the middle of a multi-step procedure, in which case they open in a new tab.

### 3.5 Tables

Use tables for reference information that has two or more attributes. Every table needs a header row. Keep tables to a maximum of 5 columns; for more attributes, use a list of definitions instead. Do not put procedures in tables.

## 4. Word choice

### 4.1 Plain language

Prefer short, common words: "use" instead of "utilize", "help" instead of "facilitate", "start" instead of "initiate". Keep sentences under 25 words on average. Explain every acronym on first use, for example "single sign-on (SSO)", except for acronyms that are more familiar than their expansion, such as URL, PDF, and API.

### 4.2 Words to avoid

Avoid "simply", "just", "easy", and "obviously", because what is easy for one reader can frustrate another. Avoid "please" in instructions, except when the user is asked to wait or to do something inconvenient, such as "Please wait while we migrate your data."

Avoid Latin abbreviations: use "for example" instead of "e.g.", "that is" instead of "i.e.", and "and so on" instead of "etc.".

### 4.3 Product terminology

Always write "sign in" (verb) and "sign-in" (noun or adjective). Never use "log in", "login", or "log on" in user-facing text. Exception: when documenting a third-party product whose UI literally says "Log in", match the third-party UI exactly.

The term "workspace" refers to a team's shared container. Do not use "org", "tenant", or "account" as synonyms for workspace. The internal code name "Project Halcyon" must never appear in public documentation; refer to the feature as "Lumen Insights".

### 4.4 Error messages

Error messages have three parts: what happened, why it happened (if known), and what the user can do next. Do not blame the user: write "We couldn't save your file" rather than "You entered an invalid file". Include the error code at the end in parentheses, for example "(LMN-2207)". Error messages must be under 150 characters, excluding the error code.

## 5. Accessibility

### 5.1 Images and alt text

Every informative image needs alt text that describes its purpose, not its appearance. Keep alt text under 125 characters. Decorative images must have empty alt text (alt=""), so that screen readers skip them. Do not start alt text with "Image of" or "Picture of".

### 5.2 Color and contrast

Never use color alone to convey meaning; pair it with an icon or text. Text must have a contrast ratio of at least 4.5:1 against its background, and large text (18 pt or larger) at least 3:1.

### 5.3 Directional language

Avoid directional language that relies on visual layout, such as "the button on the left" or "the menu above". Instead, refer to elements by their label. Exception: directional language is acceptable in instructions for physical hardware, such as "the port on the left side of the device".

## 6. Release notes

Release notes are published every second Tuesday. Each entry starts with a category tag: **New**, **Improved**, **Fixed**, or **Deprecated**. Write release notes in the past tense for fixes ("Fixed an issue where...") and in the present tense for new features ("You can now...").

Deprecation notices must give at least 90 days of notice and must include the removal date and a migration path. Security fixes are described only in general terms until 30 days after the patch ships, so that attackers cannot exploit unpatched systems.

## 7. Conflicts and precedence

When rules in this guide conflict, apply them in this order of precedence:

1. Legal and compliance requirements
2. Accessibility rules (section 5)
3. Product terminology (section 4.3)
4. All other rules

For example, if a legal notice requires the phrase "Log in to the portal", the legal requirement wins over the terminology rule. If a rule conflicts with a customer's own style guide in co-branded content, the customer's guide wins, except for accessibility rules, which always apply.

When this guide is silent on a question, follow the Chicago Manual of Style, 17th edition. For spelling, use Merriam-Webster and American English spelling throughout ("color", not "colour"), even for teams based outside the United States.

````

*End of specification.*
