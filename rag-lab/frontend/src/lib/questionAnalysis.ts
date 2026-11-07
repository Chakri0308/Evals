/** Question-set analysis ("why is this a good test?"): target colours and the auto-analysis hook. */
import { useEffect, useRef, useState } from 'react'
import { post } from '@/api/client'
import type { QAnalysis, QInsights, QItem, QTarget } from '@/lib/types'
import { useApp } from '@/store/app'
import { useQSet } from '@/store/qset'

/* ------------------------------------------------------------------ colours & labels */
export const TARGET_STYLE: Record<QTarget, { cls: string; dot: string; short: string }> = {
  semantic: { cls: 'bg-paneB/10 text-paneB border-paneB/40', dot: 'bg-paneB', short: 'Semantic' },
  bm25: { cls: 'bg-paneA/10 text-paneA border-paneA/40', dot: 'bg-paneA', short: 'BM25' },
  hybrid: { cls: 'bg-paneC/10 text-paneC border-paneC/40', dot: 'bg-paneC', short: 'Hybrid' },
  hard: { cls: 'bg-bad/10 text-bad border-bad/40', dot: 'bg-bad', short: 'Hard' },
  baseline: { cls: 'bg-elevated text-muted border-line', dot: 'bg-subtle', short: 'Baseline' },
  reasoning: { cls: 'bg-accent/10 text-accent border-accent/40', dot: 'bg-accent', short: 'Reasoning' },
  abstention: { cls: 'bg-warn/10 text-warn border-warn/40', dot: 'bg-warn', short: 'Abstain' },
}


/* ------------------------------------------------------------------ automatic analysis */
const sig = (items: QItem[]) => items.map((q) => `${q.id}|${q.category}|${q.question}|${q.gold_spans.map((g) => `${g.start}-${g.end}`).join(',')}`).join('\n')

function analysisConfig() {
  // measure on the same chunks/embeddings the panes use: the first semantic/hybrid pane, else pane A
  const s = useApp.getState()
  const ids = ['B', 'C', 'A'] as const
  const pane = ids.map((id) => s.panes[id]).find((p) => ['dense', 'hybrid'].includes(p.stages.retrieval.component)) ?? s.panes.A
  return {
    chunking: pane.stages.chunking,
    embedding_model: pane.stages.retrieval.params.embedding_model ?? null,
    paneName: pane.name,
  }
}

/** Re-analyses the set whenever questions/gold spans change (debounced), or on demand. */
export function useQuestionAnalysis(docId: string | null, items: QItem[]) {
  const insights = useQSet((s) => (docId ? s.insights[docId] : undefined))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const current = sig(items)

  const run = async (force = false) => {
    if (!docId || !items.length) return
    if (!force && insights?.signature === current && items.every((q) => q.analysis)) return
    setBusy(true)
    setErr(null)
    try {
      const cfg = analysisConfig()
      const res = await post<{ analyses: Record<string, QAnalysis>; suggestions: QInsights['suggestions']; context: QInsights['context'] }>(
        '/api/questions/analyze', {
          doc_id: docId, chunking: cfg.chunking, embedding_model: cfg.embedding_model,
          items: items.map(({ analysis: _a, ...rest }) => rest),
        })
      const qs = useQSet.getState()
      const latest = qs.byDoc[docId] ?? []
      qs.set(docId, latest.map((q) => (res.analyses[q.id] ? { ...q, analysis: res.analyses[q.id] } : q)))
      qs.setInsights(docId, { suggestions: res.suggestions, context: { ...res.context, chunker: `${res.context.chunker} (${cfg.paneName} pane)` }, signature: current })
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  useEffect(() => {
    if (!docId || !items.length || (insights?.signature === current && items.every((q) => q.analysis))) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => run(), 700)
    return () => window.clearTimeout(timer.current)
  }, [docId, current])  // eslint-disable-line react-hooks/exhaustive-deps

  return { insights, busy, err, rerun: () => run(true) }
}

