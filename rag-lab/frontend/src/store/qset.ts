import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { QInsights, QItem } from '@/lib/types'

interface QState {
  byDoc: Record<string, QItem[]>
  set: (doc: string, items: QItem[]) => void
  add: (doc: string, items: QItem[]) => void
  update: (doc: string, id: string, patch: Partial<QItem>) => void
  remove: (doc: string, id: string) => void
  evalResult?: any
  setEval: (r: any) => void
  /** "Why is this a good test?" analysis per document: suggestions + what it was measured on. */
  insights: Record<string, QInsights>
  setInsights: (doc: string, i: QInsights) => void
}

export const useQSet = create<QState>()(
  persist(
    (set) => ({
      byDoc: {},
      insights: {},
      set: (doc, items) => set((s) => ({ byDoc: { ...s.byDoc, [doc]: items } })),
      add: (doc, items) => set((s) => ({ byDoc: { ...s.byDoc, [doc]: [...(s.byDoc[doc] ?? []), ...items] } })),
      update: (doc, id, patch) => set((s) => ({ byDoc: { ...s.byDoc, [doc]: (s.byDoc[doc] ?? []).map((q) => (q.id === id ? { ...q, ...patch } : q)) } })),
      remove: (doc, id) => set((s) => ({ byDoc: { ...s.byDoc, [doc]: (s.byDoc[doc] ?? []).filter((q) => q.id !== id) } })),
      setEval: (r) => set({ evalResult: r }),
      setInsights: (doc, i) => set((s) => ({ insights: { ...s.insights, [doc]: i } })),
    }),
    { name: 'rag-lab-qsets', partialize: (s) => ({ byDoc: s.byDoc, insights: s.insights }) },
  ),
)

export function toCSV(items: QItem[]): string {
  const cols = ['id', 'category', 'question', 'expected_answer', 'difficulty', 'what_it_stresses', 'notes', 'gold_quotes',
    'tests', 'why', 'bm25_rank', 'semantic_rank', 'hybrid_rank']
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return [cols.join(','), ...items.map((q) => [q.id, q.category, q.question, q.expected_answer, q.difficulty, q.what_it_stresses, q.notes,
    q.gold_spans.map((g) => g.quote).join(' || '), q.analysis?.label, q.analysis?.headline,
    q.analysis?.ranks.bm25, q.analysis?.ranks.semantic, q.analysis?.ranks.hybrid].map(esc).join(','))].join('\n')
}


export function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = [], cur = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cur); rows.push(row); row = []; cur = ''
    } else cur += c
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  const [head, ...rest] = rows
  return rest.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

export function download(name: string, content: string, type = 'application/json') {
  const u = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = u
  a.download = name
  a.click()
  URL.revokeObjectURL(u)
}
