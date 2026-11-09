import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, put } from '@/api/client'
import { useApp } from '@/store/app'
import type { PaneId } from '@/lib/types'

export type Verdict = 'up' | 'down' | null
export type Relevance = 'relevant' | 'irrelevant'

export interface AnnChunk { id: string; start: number; end: number; text: string; page?: number | null; heading_path: string[] }

export interface Annotation {
  id: string
  doc_id: string
  question: string
  pane: string
  pipeline: string
  config: Record<string, any>
  answer: string
  cited: string[]
  chunks: AnnChunk[]
  verdict: Verdict
  note: string
  chunk_labels: Record<string, Relevance>
  created?: number
  updated?: number
}

/** FNV-1a, enough to give each (document, question, pipeline config) its own stable key. */
function fnv(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36)
}

/** One annotation per document + question + pipeline config: re-running the same thing shows the same labels. */
export function annotationId(docId: string, question: string, cfgHash: string): string {
  return `${docId.slice(0, 8)}-${fnv(question.trim())}-${fnv(cfgHash)}`
}

export function useAnnotations(docId: string | null | undefined) {
  return useQuery({
    queryKey: ['annotations', docId],
    queryFn: () => api<Annotation[]>(`/api/annotations?doc_id=${encodeURIComponent(docId!)}`),
    enabled: !!docId,
  })
}

/** The annotation for a pane's last run (if any) plus a `save(patch)` that snapshots the run and upserts. */
export function usePaneAnnotation(pane: PaneId) {
  const docId = useApp((s) => s.docId)
  const run = useApp((s) => s.runs[pane])
  const qc = useQueryClient()
  const { data: list } = useAnnotations(docId)
  const res = run.result
  const id = docId && res && run.configHash ? annotationId(docId, res.question, run.configHash) : null
  const current = id ? list?.find((a) => a.id === id) : undefined

  const m = useMutation({
    mutationFn: (body: Annotation) => put<any>(`/api/annotations/${encodeURIComponent(body.id)}`, body),
    onMutate: async (body) => {
      // optimistic: the UI reflects the click immediately
      const key = ['annotations', docId]
      await qc.cancelQueries({ queryKey: key })
      const empty = body.verdict === null && !body.note.trim() && !Object.keys(body.chunk_labels).length
      qc.setQueryData<Annotation[]>(key, (old = []) => {
        const rest = old.filter((a) => a.id !== body.id)
        return empty ? rest : [body, ...rest]
      })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['annotations', docId] }),
  })

  const save = (patch: Partial<Pick<Annotation, 'verdict' | 'note' | 'chunk_labels'>>) => {
    if (!id || !docId || !res) return
    const cfg = useApp.getState().panes[pane]
    const chunks: AnnChunk[] = res.hits.map((h) => res.chunks[h.chunk_id]).filter(Boolean)
      .map((c) => ({ id: c.id, start: c.start, end: c.end, text: c.text, page: c.page, heading_path: c.heading_path }))
    m.mutate({
      id, doc_id: docId, question: res.question, pane, pipeline: cfg.name, config: cfg,
      answer: run.answer || res.answer || '', cited: res.cited, chunks,
      verdict: current?.verdict ?? null, note: current?.note ?? '', chunk_labels: current?.chunk_labels ?? {},
      ...patch,
    })
  }

  return { id, current, save, canAnnotate: !!id && run.status === 'done' }
}
