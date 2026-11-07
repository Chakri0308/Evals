import { useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Download, Loader2, Play, Plus, RefreshCw, Search, Sparkles, Trash2, Upload, Wand2 } from 'lucide-react'
import { post, sse } from '@/api/client'
import { useCategories } from '@/api/hooks'
import { LlmPicker, type LlmChoice } from '@/components/common/LlmPicker'
import { TARGET_STYLE, useQuestionAnalysis } from '@/lib/questionAnalysis'
import { RankMini, SuggestionsPanel, TargetPill, WhyPanel } from './QInsights'
import { useApp } from '@/store/app'
import { download, parseCSV, toCSV, useQSet } from '@/store/qset'
import type { QItem, QTarget } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Badge, Button, Empty, Segmented, Select, Tip } from '@/components/ui'

export function QGenTab() {
  const docId = useApp((s) => s.docId)
  const { data: cats } = useCategories()
  const items = useQSet((s) => (docId ? s.byDoc[docId] : undefined)) ?? []
  const qs = useQSet.getState()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [mode, setMode] = useState<'llm' | 'heuristic'>('llm')
  const [llm, setLlm] = useState<LlmChoice>({ provider: 'default', model: '' })
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState<'all' | QTarget>('all')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const { insights, busy: aBusy, err: aErr, rerun } = useQuestionAnalysis(docId ?? null, items)
  const pick = (id: string) => {
    setFilter('all'); setTarget('all'); setSearch('')
    setOpen((o) => ({ ...o, [id]: true }))
    setTimeout(() => document.getElementById(`qrow-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }

  const cnt = (id: string) => counts[id] ?? 1
  const total = (cats ?? []).reduce((s, c) => s + cnt(c.id), 0)

  const generate = async () => {
    if (!docId) return
    setErr(null)
    setBusy({ done: 0, total })
    const fresh: QItem[] = []
    try {
      await sse('/api/questions/generate', {
        doc_id: docId, mode, llm: { provider: llm.provider, model: llm.model || null },
        categories: Object.fromEntries((cats ?? []).map((c) => [c.id, cnt(c.id)]).filter(([, n]) => +n > 0)),
      }, (ev, d) => {
        if (ev === 'progress') { setBusy({ done: d.done, total: d.total }); if (d.item) fresh.push(d.item) }
        if (ev === 'result') qs.set(docId, [...items.filter((i) => i.source === 'manual'), ...d.items])
        if (ev === 'fatal') setErr(d.message)
      })
    } catch (e: any) { setErr(e.message) } finally { setBusy(null) }
  }

  const shown = useMemo(() => items.filter((q) => (filter === 'all' || q.category === filter) &&
    (target === 'all' || q.analysis?.target === target) &&
    (!search || (q.question + q.expected_answer).toLowerCase().includes(search.toLowerCase()))), [items, filter, search, target])
  const catLabel = (id: string) => cats?.find((c) => c.id === id)?.label ?? id

  const runText = (text: string) => {
    const a = useApp.getState()
    a.setQuestion(text)
    setTimeout(() => a.runPanes(), 0)
  }
  const runQuestion = (q: QItem) => runText(q.question)
  const importFile = () => {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = '.json,.csv'
    inp.onchange = async () => {
      const f = inp.files?.[0]
      if (!f || !docId) return
      const txt = await f.text()
      let arr: any[]
      if (f.name.endsWith('.csv')) {
        arr = parseCSV(txt).map((r) => ({ ...r, gold_spans: [], invalid_quotes: r.gold_quotes ? r.gold_quotes.split(' || ') : [] }))
      } else arr = JSON.parse(txt)
      const validated = await Promise.all(arr.map((it: any) => post<QItem>('/api/questions/validate', {
        doc_id: docId, item: { id: it.id || Math.random().toString(36).slice(2, 10), category: it.category || 'single_hop', question: it.question || '',
          expected_answer: it.expected_answer || '', gold_spans: it.gold_spans || [], invalid_quotes: it.invalid_quotes || [], difficulty: it.difficulty || 'medium',
          what_it_stresses: it.what_it_stresses || '', notes: it.notes || '', source: it.source || 'import' },
      })))
      qs.set(docId, validated)
    }
    inp.click()
  }

  if (!docId) return <Empty title="No document">Choose a document to generate a test set.</Empty>

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[330px] shrink-0 flex-col border-r border-line">
        <div className="space-y-2 border-b border-line p-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Generator</span>
            <Segmented className="ml-auto" size="xs" value={mode} onChange={setMode}
              options={[{ value: 'llm', label: 'LLM', title: 'The selected LLM writes questions section by section (falls back to templates if no LLM is available)' }, { value: 'heuristic', label: 'Templates', title: 'Fast, offline templates' }]} />
          </div>
          {mode === 'llm' && <LlmPicker value={llm} onChange={setLlm} />}
          <div className="flex items-center gap-2">
            <Button variant="primary" className="flex-1" onClick={generate} disabled={!!busy || total === 0}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              {busy ? `Generating ${busy.done}/${busy.total}` : `Generate ${total} questions`}
            </Button>
          </div>
          {busy && <div className="h-1 overflow-hidden rounded-full bg-line"><div className="h-full bg-accent transition-all" style={{ width: `${(busy.done / Math.max(1, busy.total)) * 100}%` }} /></div>}
          {err && <div className="text-[11px] text-bad">{err}</div>}
          {mode === 'llm' && <div className="text-[10.5px] leading-snug text-subtle">LLM mode on CPU takes about 5–15s per question. Every gold quote is validated against the document, with a template fallback if the model fails.</div>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {(cats ?? []).map((c) => (
            <div key={c.id} className="group rounded-lg px-2 py-1.5 hover:bg-elevated/60">
              <div className="flex items-center gap-2">
                <button onClick={() => setFilter(filter === c.id ? 'all' : c.id)} className={cn('min-w-0 flex-1 truncate text-left text-[12.5px] font-medium', filter === c.id && 'text-accent')}>{c.label}</button>
                <span className="num text-[10.5px] text-subtle">{items.filter((q) => q.category === c.id).length || ''}</span>
                <div className="flex items-center rounded-md border border-line">
                  <button className="px-1.5 text-xs text-muted hover:text-fg" onClick={() => setCounts({ ...counts, [c.id]: Math.max(0, cnt(c.id) - 1) })}>−</button>
                  <span className="num w-4 text-center text-[11px]">{cnt(c.id)}</span>
                  <button className="px-1.5 text-xs text-muted hover:text-fg" onClick={() => setCounts({ ...counts, [c.id]: Math.min(10, cnt(c.id) + 1) })}>+</button>
                </div>
              </div>
              <div className="mt-0.5 text-[11px] leading-snug text-subtle">{c.explain}</div>
              <div className="mt-0.5 text-[10.5px] text-accent/80">stresses: {c.stresses}</div>
            </div>
          ))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <div className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-elevated px-2">
            <Search className="h-3 w-3 text-subtle" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter questions…" className="w-44 bg-transparent text-xs focus:outline-none" />
          </div>
          {filter !== 'all' && <Badge tone="accent" className="cursor-pointer" onClick={() => setFilter('all')}>{catLabel(filter)} ✕</Badge>}
          <Select className="w-36" value={target} onChange={(v) => setTarget(v as any)}
            options={[{ value: 'all', label: 'All tests' }, ...(Object.keys(TARGET_STYLE) as QTarget[]).map((t) => ({ value: t, label: `Tests: ${TARGET_STYLE[t].short}` }))]} />
          <span className="num text-[11px] text-subtle">{shown.length} / {items.length}</span>
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => qs.add(docId, [{ id: Math.random().toString(36).slice(2, 10), category: filter === 'all' ? 'single_hop' : filter, question: 'New question', expected_answer: '', gold_spans: [], difficulty: 'medium', what_it_stresses: '', notes: '', source: 'manual', valid: false }])}><Plus className="h-3 w-3" />Add</Button>
            <Button size="sm" variant="ghost" onClick={importFile}><Upload className="h-3 w-3" />Import</Button>
            <Button size="sm" variant="ghost" disabled={!items.length} onClick={() => download('questions.json', JSON.stringify(items, null, 2))}><Download className="h-3 w-3" />JSON</Button>
            <Button size="sm" variant="ghost" disabled={!items.length} onClick={() => download('questions.csv', toCSV(items), 'text/csv')}><Download className="h-3 w-3" />CSV</Button>
            <Button size="sm" variant="danger" disabled={!items.length} onClick={() => confirm('Delete all questions for this document?') && qs.set(docId, [])}><Trash2 className="h-3 w-3" /></Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {!!items.length && <SuggestionsPanel insights={insights} busy={aBusy} err={aErr} onRerun={rerun} onPick={pick} onRun={runText} />}
          {!items.length ? (
            <Empty icon={<Sparkles className="h-4 w-4" />} title="No test questions yet">Pick categories on the left and generate a set. Edit any cell inline, and press ▶ to run a question across all panes.</Empty>
          ) : (
            <table className="mt-2 w-full text-[12px]">
              <thead className="sticky top-0 z-10 bg-bg text-left text-[10.5px] uppercase tracking-wider text-subtle">
                <tr>
                  <th className="w-14 px-2 py-1.5" /><th className="px-2 font-semibold">Category</th><th className="px-2 font-semibold">Tests</th><th className="px-2 font-semibold">Question</th>
                  <th className="px-2 font-semibold">Expected answer</th><th className="px-2 font-semibold">Gold</th><th className="px-2 font-semibold">Diff.</th><th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {shown.map((q) => <Row key={q.id} q={q} doc={docId} catLabel={catLabel(q.category)} onRun={() => runQuestion(q)}
                  open={!!open[q.id]} onToggle={() => setOpen((o) => ({ ...o, [q.id]: !o[q.id] }))} />)}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ q, doc, catLabel, onRun, open, onToggle }: { q: QItem; doc: string; catLabel: string; onRun: () => void; open: boolean; onToggle: () => void }) {
  const qs = useQSet.getState()
  const [busy, setBusy] = useState(false)
  const revalidate = async (patch?: Partial<QItem>) => {
    setBusy(true)
    try { const r = await post<QItem>('/api/questions/validate', { doc_id: doc, item: { ...q, ...patch } }); qs.update(doc, q.id, r) } finally { setBusy(false) }
  }
  const valid = q.valid ?? q.gold_spans.length > 0
  return (
    <>
    <tr id={`qrow-${q.id}`} className={cn('group scroll-mt-10 border-t border-line/60 align-top hover:bg-surface/60', open && 'bg-brand/[0.03]')}>
      <td className="px-2 py-1.5">
        <div className="flex items-center">
          <Tip content={open ? 'Hide the explanation' : 'Why is this a good test? (terminology map, retriever ranks)'}>
            <button onClick={onToggle} className="rounded-md p-1 text-subtle hover:bg-elevated hover:text-fg">{open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</button>
          </Tip>
          <Tip content="Send to the question bar and run all panes">
            <button onClick={onRun} className="rounded-md p-1 text-accent hover:bg-accent/15"><Play className="h-3 w-3" /></button>
          </Tip>
        </div>
      </td>
      <td className="px-2 py-1.5">
        <div className="text-[11.5px] font-medium">{catLabel}</div>
        <div className="text-[10.5px] text-subtle">{q.what_it_stresses}</div>
      </td>
      <td className="px-2 py-1.5">
        <button onClick={onToggle} className="text-left"><TargetPill a={q.analysis} /><RankMini a={q.analysis} /></button>
      </td>
      <td className="min-w-[260px] px-2 py-1"><Cell value={q.question} onChange={(v) => qs.update(doc, q.id, { question: v })} /></td>
      <td className="min-w-[220px] px-2 py-1"><Cell value={q.expected_answer} muted onChange={(v) => qs.update(doc, q.id, { expected_answer: v })} /></td>
      <td className="px-2 py-1.5">
        <Tip content={<div className="max-w-sm space-y-1">
          {q.gold_spans.map((g, i) => <div key={i}><span className="text-subtle">{g.heading_path.slice(-1)[0] ?? (g.page ? `p.${g.page}` : '')} · {g.match}</span><br />“{g.quote.slice(0, 220)}”</div>)}
          {(q.invalid_quotes ?? []).map((g, i) => <div key={'x' + i} className="text-bad">✗ not found: “{g.slice(0, 160)}”</div>)}
          {!q.gold_spans.length && !(q.invalid_quotes ?? []).length && <div className="text-subtle">No gold span (expected for unanswerable/ambiguous)</div>}
          {q.notes && <div className="text-muted">{q.notes}</div>}
        </div>}>
          <span className={cn('num inline-flex cursor-help items-center gap-1 text-[11px]', valid ? 'text-good' : 'text-warn')}>
            {valid ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}{q.gold_spans.length}
          </span>
        </Tip>
      </td>
      <td className="px-2 py-1">
        <select value={q.difficulty} onChange={(e) => qs.update(doc, q.id, { difficulty: e.target.value })}
          className="rounded border border-transparent bg-transparent text-[11.5px] text-muted hover:border-line focus:outline-none">
          {['easy', 'medium', 'hard'].map((d) => <option key={d} value={d} className="bg-elevated">{d}</option>)}
        </select>
      </td>
      <td className="px-1 py-1.5">
        <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
          <Tip content="Re-validate gold spans"><button onClick={() => revalidate()} className="rounded p-1 text-subtle hover:text-fg">{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}</button></Tip>
          <Tip content="Delete"><button onClick={() => qs.remove(doc, q.id)} className="rounded p-1 text-subtle hover:text-bad"><Trash2 className="h-3 w-3" /></button></Tip>
        </div>
      </td>
    </tr>
    {open && (
      <tr className="bg-brand/[0.03]">
        <td colSpan={8} className="px-3 pb-3 pt-0.5"><WhyPanel q={q} /></td>
      </tr>
    )}
    </>
  )
}

function Cell({ value, onChange, muted }: { value: string; onChange: (v: string) => void; muted?: boolean }) {
  const [v, setV] = useState(value)
  const [edit, setEdit] = useState(false)
  if (!edit) return <div onClick={() => { setV(value); setEdit(true) }} className={cn('cursor-text rounded px-1 py-0.5 leading-snug hover:bg-elevated', muted ? 'text-muted' : 'text-fg')}>{value || <span className="italic text-subtle">empty</span>}</div>
  return (
    <textarea autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { setEdit(false); if (v !== value) onChange(v) }} rows={3}
      className="w-full resize-y rounded border border-accent/50 bg-elevated p-1 text-[12px] leading-snug focus:outline-none" />
  )
}
