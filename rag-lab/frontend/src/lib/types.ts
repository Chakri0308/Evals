export type StageName =
  | 'query_transform' | 'chunking' | 'retrieval' | 'fusion' | 'rerank' | 'context_filter' | 'prompt' | 'generation'

export const STAGES: StageName[] = [
  'query_transform', 'chunking', 'retrieval', 'fusion', 'rerank', 'context_filter', 'prompt', 'generation',
]

export const STAGE_LABEL: Record<StageName, string> = {
  query_transform: 'Query', chunking: 'Chunk', retrieval: 'Retrieve', fusion: 'Fuse',
  rerank: 'Rerank', context_filter: 'Filter', prompt: 'Prompt', generation: 'Generate',
}

export type PaneId = 'A' | 'B' | 'C'
export const PANE_IDS: PaneId[] = ['A', 'B', 'C']

export interface StageConfig { enabled: boolean; component: string; params: Record<string, any> }

export interface PipelineConfig {
  id: PaneId
  name: string
  color: string
  tokenizer: string
  stages: Record<StageName, StageConfig>
}

export interface JSONSchema {
  type?: string
  title?: string
  description?: string
  default?: any
  minimum?: number
  maximum?: number
  enum?: any[]
  properties?: Record<string, JSONSchema>
  examples?: any[]
  'x-widget'?: string
  'x-suggest'?: string
  'x-options'?: string
  anyOf?: JSONSchema[]
  $ref?: string
}

export interface ComponentInfo { name: string; label: string; description: string; schema: JSONSchema }

export interface Registry {
  stages: { stage: StageName; kind: string; components: ComponentInfo[] }[]
  kinds: Record<string, ComponentInfo[]>
  default_panes: PipelineConfig[]
}

export interface DocStats { id: string; name: string; kind: string; pages: number; tokens: number; sections: number; chars: number }

export interface Block { kind: string; start: number; end: number; page?: number | null; level: number; heading_path: string[] }

export interface Chunk {
  id: string; index: number; start: number; end: number; text: string; index_text: string
  tokens: number; page?: number | null; heading_path: string[]
}

export interface Hit {
  chunk_id: string
  scores: Record<string, number>
  ranks: Record<string, number>
  dropped_by?: string | null
  drop_reason?: string | null
}

export interface StageState {
  stage: StageName
  status: 'pending' | 'running' | 'ok' | 'skipped' | 'error' | 'not_ready'
  ms?: number
  count_in?: number
  count_out?: number
  component?: string
  reason?: string
  error?: string
  trace?: any
}

export interface RunResult {
  pane: PaneId
  question: string
  answer: string
  hits: Hit[]
  dropped: Hit[]
  chunks: Record<string, Chunk>
  cited: string[]
  usage: { input_tokens: number; output_tokens: number; cost_usd: number }
  timings: Record<string, number>
  total_ms: number
  traces: Record<string, any>
  status: Record<string, string>
  prompt?: { system: string; user: string; tokens: number; closed_book: boolean }
  query_bundle?: { original: string; queries: string[]; dense_queries: string[]; notes: Record<string, any> }
  error?: { stage: string; message: string }
  chunkset_key?: string
  num_chunks?: number
  not_ready?: Readiness
  notices?: { stage: string; message: string }[]
  answer_source?: { kind: string; wanted: string; reason: string }
}

export interface ReadinessCheck { id: string; label: string; state: 'ok' | 'missing' | 'pending' | 'fallback' | 'info'; detail: string; fix: string }
export interface Readiness {
  ready: boolean; retriever: string; missing: string[]; checks: ReadinessCheck[]
  headline: string; quip: string; ok_count: number; total: number
}

export interface ProviderRow { name: string; label: string; description: string; ready: boolean; detail: string; uses_model: boolean; default_model: string; examples: string[] }
export interface StoreRow { name: string; label: string; description: string; ready: boolean; detail: string; needs: string }
export interface AppSettings { llm_provider: string; llm_model: string; embedding_model: string; vector_store: string; allow_llm: boolean; allow_embeddings: boolean }
export interface Capabilities {
  settings: AppSettings; locks: Record<string, string>; mode: 'full' | 'no_llm' | 'no_embeddings' | 'offline'; any_llm_ready: boolean
  llms: ProviderRow[]; embedders: { name: string; ready: boolean; detail: string }[]; vector_stores: StoreRow[]
}

export interface PaneRun {
  status: 'idle' | 'running' | 'done' | 'error'
  token: number
  stages: Partial<Record<StageName, StageState>>
  answer: string
  result?: RunResult
  error?: { stage: string; message: string }
  configHash?: string
  question?: string
  startedAt?: number
}

export interface QItem {
  id: string
  category: string
  question: string
  expected_answer: string
  gold_spans: { start: number; end: number; page?: number | null; heading_path: string[]; quote: string; match: string }[]
  difficulty: string
  what_it_stresses: string
  notes: string
  source?: string
  valid?: boolean
  invalid_quotes?: string[]
  analysis?: QAnalysis
}

export type QTarget = 'bm25' | 'semantic' | 'hybrid' | 'hard' | 'baseline' | 'abstention' | 'reasoning'
export interface QTerm {
  term: string; status: 'gold' | 'gold_section' | 'elsewhere' | 'variant' | 'absent'
  chunks: number; occurrences: number; idf: number; variants?: string[]; also_in?: string[]; also_in_count?: number
}
export interface QAnalysis {
  target: QTarget; label: string; tests: string; headline: string; reasons: string[]; if_fails: string
  estimated: boolean; category_mismatch: string | null
  terms: QTerm[]; gap_terms: string[]; overlap: number | null; identifiers: string[]; negation: boolean
  gold_chunks: string[]; gold_sections: string[]
  ranks: { bm25: number | null; semantic: number | null; hybrid: number | null; of: number }
  top_distractor: { chunk: string; section: string; beats_gold: boolean } | null
}
export interface QSuggestionGroup { id: string; title: string; hint: string; items: { id: string; question: string; label: string; ranks: QAnalysis['ranks']; why: string }[] }
export interface QInsights {
  suggestions: { groups: QSuggestionGroup[]; counts: Record<string, number>; advice: string[] }
  context: { chunks: number; chunker: string; embedding_model: string; semantic_measured: boolean; note: string }
  signature: string
}

export interface Category { id: string; label: string; stresses: string; explain: string; sections: number }
