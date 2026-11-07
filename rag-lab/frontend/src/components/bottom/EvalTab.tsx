import { useMemo, useState } from 'react'
import { BarChart3, Download, FlaskConical, Loader2, Play, Trophy } from 'lucide-react'
import { sse } from '@/api/client'
import { useCategories } from '@/api/hooks'
import { LlmPicker, type LlmChoice } from '@/components/common/LlmPicker'
import { useApp, visiblePanes } from '@/store/app'
import { download, useQSet } from '@/store/qset'
import type { PaneId } from '@/lib/types'
import { cn, fmtMs } from '@/lib/utils'
import { Badge, Button, Empty, Segmented, Select, Switch, Tip } from '@/components/ui'

const RUBRIC = `correctness (1-5): how well the answer matches the expected answer
faithfulness (1-5): is every claim supported by the retrieved context?
citation accuracy (0-1): share of cited chunks that contain gold evidence
abstention: unanswerable / false-premise questions should be declined`

export function EvalTab() {
  const docId = useApp((s) => s.docId)
  const vis = useApp(visiblePanes)
  const panes = useApp((s) => s.panes)
  const items = useQSet((s) => (docId ? s.byDoc[docId] : undefined)) ?? []
  const result = useQSet((s) => s.evalResult)
  const setEval = useQSet((s) => s.setEval)
  const { data: cats } = useCategories()
  const [selCats, setSelCats] = useState<string[]>([])
  const [k, setK] = useState(5)
  const [judge, setJudge] = useState<'heuristic' | 'llm'>('heuristic')
  const [judgeLlm, setJudgeLlm] = useState<LlmChoice>({ provider: 'default', model: '' })
  const [answers, setAnswers] = useState(true)
  const [prog, setProg] = useState<{ done: number; total: number; last?: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [metric, setMetric] = useState<string>('recall')

  const subset = items.filter((q) => !selCats.length || selCats.includes(q.category))
  const presentCats = [...new Set(items.map((q) => q.category))]
  const catLabel = (id: string) => cats?.find((c) => c.id === id)?.label ?? id

  const run = async () => {
    if (!docId || !subset.length) return
    setErr(null)
    setProg({ done: 0, total: subset.length * vis.length })
    try {
      await sse('/api/eval', {
        doc_id: docId, questions: subset, pipelines: vis.map((p) => panes[p]), k, generate_answers: answers,
        judge: judge === 'llm' ? { component: 'llm', params: { provider: judgeLlm.provider, model: judgeLlm.model } } : { component: 'heuristic', params: {} },
      }, (ev, d) => {
        if (ev === 'progress') setProg({ done: d.done, total: d.total, last: d.row?.question })
        if (ev === 'result') setEval(d)
        if (ev === 'fatal') setErr(d.message)
      })
    } catch (e: any) { setErr(e.message) } finally { setProg(null) }
  }

  if (!docId) return <Empty title="No document" />
  return (
    <div className="flex h-full min-h-0">
      <aside className="w-[300px] shrink-0 space-y-3 overflow-y-auto border-r border-line p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Batch evaluation</div>
        {!items.length ? (
          <div className="rounded-lg border border-dashed border-line p-3 text-xs text-muted">Generate a question set in the <b>Question Generator</b> tab first.</div>
        ) : (
          <>
            <div>
              <div className="mb-1 flex items-center text-xs text-muted">Categories <span className="num ml-auto text-subtle">{subset.length} questions</span></div>
              <div className="flex flex-wrap gap-1">
                {presentCats.map((c) => (
                  <button key={c} onClick={() => setSelCats(selCats.includes(c) ? selCats.filter((x) => x !== c) : [...selCats, c])}
                    className={cn('rounded-full border px-2 py-0.5 text-[11px]', selCats.includes(c) ? 'border-accent/60 bg-accent/15 text-fg' : 'border-line text-muted hover:text-fg')}>{catLabel(c)}</button>
                ))}
              </div>
              {!!selCats.length && <button onClick={() => setSelCats([])} className="mt-1 text-[11px] text-subtle hover:text-fg">clear filter (use all)</button>}
            </div>
            <div className="flex items-center justify-between text-xs text-muted">k for @k metrics <Segmented size="xs" value={k} onChange={setK} options={[3, 5, 10].map((v) => ({ value: v, label: String(v) }))} /></div>
            <div className="flex items-center justify-between text-xs text-muted">Generate + judge answers <Switch size="sm" checked={answers} onCheckedChange={setAnswers} /></div>
            {answers && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted">Judge
                  <Segmented size="xs" value={judge} onChange={setJudge} options={[{ value: 'heuristic', label: 'Heuristic' }, { value: 'llm', label: 'LLM' }]} />
                </div>
                {judge === 'llm' && <LlmPicker compact value={judgeLlm} onChange={setJudgeLlm} />}
                <Tip content={<pre className="whitespace-pre-wrap font-mono text-[10.5px]">{RUBRIC}</pre>}>
                  <div className="cursor-help text-[11px] text-accent">View rubric</div>
                </Tip>
              </div>
            )}
            <Button variant="primary" className="w-full" disabled={!!prog || !subset.length} onClick={run}>
              {prog ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
              {prog ? `Running ${prog.done}/${prog.total}` : `Evaluate ${vis.length} config${vis.length > 1 ? 's' : ''}`}
            </Button>
            {prog && (
              <div>
                <div className="h-1 overflow-hidden rounded-full bg-line"><div className="h-full bg-accent transition-all" style={{ width: `${(prog.done / prog.total) * 100}%` }} /></div>
                {prog.last && <div className="mt-1 truncate text-[10.5px] text-subtle">{prog.last}</div>}
              </div>
            )}
            {answers && <div className="text-[10.5px] leading-snug text-subtle">Answers go through each pane's LLM (local Ollama on CPU: about 3–8s per question per pane; no-LLM mode answers instantly). Turn off "Generate" for an instant retrieval-only eval.</div>}
            {err && <div className="text-[11px] text-bad">{err}</div>}
          </>
        )}
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto p-3">
        {!result ? (
          <Empty icon={<BarChart3 className="h-4 w-4" />} title="No results yet">Run an evaluation to see the leaderboard, a per-category breakdown of where each retrieval strategy fails, and per-question drill-downs.</Empty>
        ) : (
          <Results r={result} metric={metric} setMetric={setMetric} catLabel={catLabel} />
        )}
      </div>
    </div>
  )
}

function Results({ r, metric, setMetric, catLabel }: { r: any; metric: string; setMetric: (m: string) => void; catLabel: (c: string) => string }) {
  const k = r.k
  const lb: any[] = r.leaderboard
  const pct = (v: number | null) => (v === null || v === undefined ? '–' : (v * 100).toFixed(0) + '%')
  const num = (v: number | null, d = 2) => (v === null || v === undefined ? '–' : v.toFixed(d))
  const exportCSV = () => {
    const cols = ['question_id', 'category', 'pane', 'pipeline', 'question', `hit@${k}`, `recall@${k}`, 'mrr', `ndcg@${k}`, 'correctness', 'faithfulness', 'citation_accuracy', 'abstention_correct', 'latency_ms', 'tokens_in', 'tokens_out', 'answer']
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = r.rows.map((x: any) => cols.map((c) => esc(x[c] ?? x.judge?.[c])).join(','))
    download(`eval-${r.id}.csv`, [cols.join(','), ...lines].join('\n'), 'text/csv')
  }
  const best = (key: string, higher = true) => {
    const vals = lb.map((e) => e[key]).filter((v) => v !== null && v !== undefined)
    return vals.length ? (higher ? Math.max(...vals) : Math.min(...vals)) : null
  }
  const cols: [string, string, (v: any) => string, boolean][] = [
    [`hit@${k}`, `Hit@${k}`, pct, true], [`recall@${k}`, `Recall@${k}`, pct, true], ['mrr', 'MRR', (v) => num(v), true], [`ndcg@${k}`, `nDCG@${k}`, (v) => num(v), true],
    ['correctness', 'Correct', (v) => num(v, 1), true], ['faithfulness', 'Faithful', (v) => num(v, 1), true], ['citation_accuracy', 'Cite acc', pct, true],
    ['abstention_acc', 'Abstain', pct, true], ['latency_p50', 'p50', fmtMs, false], ['latency_p95', 'p95', fmtMs, false],
  ]
  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-line bg-surface p-3">
        <div className="mb-2 flex items-center gap-2">
          <Trophy className="h-3.5 w-3.5 text-warn" />
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Leaderboard</h3>
          <span className="num text-[11px] text-subtle">{r.rows.length} runs · {r.duration_s}s · judge {r.judge?.component}</span>
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={exportCSV}><Download className="h-3 w-3" />CSV</Button>
            <Button size="sm" variant="ghost" onClick={() => download(`eval-${r.id}.json`, JSON.stringify(r, null, 2))}><Download className="h-3 w-3" />JSON</Button>
          </div>
        </div>
        <table className="w-full text-[12px]">
          <thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-subtle"><th className="pb-1">Config</th>{cols.map(([, l]) => <th key={l} className="pb-1 text-right">{l}</th>)}<th className="pb-1 text-right">Tokens</th></tr></thead>
          <tbody>
            {lb.map((e, i) => (
              <tr key={e.pane} className={`pane-${e.pane} border-t border-line/60`}>
                <td className="py-1.5"><span className="inline-flex items-center gap-1.5"><span className="num w-4 text-subtle">{i + 1}</span><span className="h-2 w-2 rounded-full bg-pc" /><span className="font-medium">{e.pipeline}</span>{e.errors > 0 && <Badge tone="bad">{e.errors} err</Badge>}</span></td>
                {cols.map(([key, l, f, hi]) => (
                  <td key={l} className={cn('num py-1.5 text-right', e[key] !== null && e[key] === best(key, hi) && lb.length > 1 ? 'font-semibold text-good' : 'text-fg')}>{f(e[key])}</td>
                ))}
                <td className="num py-1.5 text-right text-muted">{e.tokens_in + e.tokens_out}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <CategoryChart r={r} metric={metric} setMetric={setMetric} catLabel={catLabel} />
      <DrillDown r={r} catLabel={catLabel} />
    </div>
  )
}

function CategoryChart({ r, metric, setMetric, catLabel }: { r: any; metric: string; setMetric: (m: string) => void; catLabel: (c: string) => string }) {
  const k = r.k
  const key = metric === 'recall' ? `recall@${k}` : metric === 'hit' ? `hit@${k}` : metric === 'mrr' ? 'mrr' : 'correctness'
  const scale = metric === 'correctness' ? 5 : 1
  const panes: { pane: PaneId; pipeline: string }[] = r.pipelines.map((p: any) => ({ pane: p.id, pipeline: p.name }))
  const catsList = Object.keys(r.by_category)
  const [hov, setHov] = useState<string | null>(null)
  return (
    <section className="rounded-xl border border-line bg-surface p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Per-category: which strategy fails where</h3>
        <Segmented className="ml-auto" size="xs" value={metric} onChange={setMetric}
          options={[{ value: 'recall', label: `Recall@${k}` }, { value: 'hit', label: `Hit@${k}` }, { value: 'mrr', label: 'MRR' }, { value: 'correctness', label: 'Correctness' }]} />
      </div>
      <div className="mb-2 flex flex-wrap gap-3 text-[11px] text-muted">
        {panes.map((p) => <span key={p.pane} className={`pane-${p.pane} inline-flex items-center gap-1.5`}><span className="h-2 w-2 rounded-sm bg-pc" />{p.pipeline}</span>)}
        <span className="ml-auto text-subtle">{hov ?? 'hover a bar for its value'}</span>
      </div>
      <div className="space-y-2">
        {catsList.map((c) => {
          const row = r.by_category[c]
          const vals = panes.map((p) => row[p.pane]?.[key] as number | null)
          const valid = vals.filter((v) => v !== null && v !== undefined) as number[]
          const top = valid.length ? Math.max(...valid) : null
          return (
            <div key={c} className="grid grid-cols-[170px_1fr] items-center gap-3">
              <div className="min-w-0">
                <div className="truncate text-[12px] font-medium">{catLabel(c)}</div>
                <div className="num text-[10.5px] text-subtle">n={row[panes[0].pane]?.n ?? 0}</div>
              </div>
              <div className="flex flex-col gap-[2px]">
                {panes.map((p, i) => {
                  const v = vals[i]
                  const w = v === null || v === undefined ? 0 : (v / scale) * 100
                  const label = v === null || v === undefined ? 'n/a' : metric === 'correctness' ? v.toFixed(1) : metric === 'mrr' ? v.toFixed(2) : `${Math.round(v * 100)}%`
                  return (
                    <div key={p.pane} className={`pane-${p.pane} flex h-[9px] items-center gap-2`}
                      onMouseEnter={() => setHov(`${catLabel(c)} · ${p.pipeline}: ${label}`)} onMouseLeave={() => setHov(null)}>
                      <div className="relative h-full flex-1 rounded-r bg-line/40">
                        {v === null || v === undefined
                          ? <div className="band-stripe absolute inset-y-0 left-0 w-full rounded-r opacity-40" />
                          : <div className="absolute inset-y-0 left-0 rounded-r-[4px] bg-pc transition-all" style={{ width: `${Math.max(w, 1)}%` }} />}
                      </div>
                      <span className={cn('num w-9 text-right text-[10px]', v !== null && v === top && valid.length > 1 ? 'font-semibold text-fg' : 'text-subtle')}>{label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-2 text-[10.5px] text-subtle">Retrieval metrics exclude unanswerable/ambiguous questions (no gold span). Striped = not applicable.</div>
    </section>
  )
}

function DrillDown({ r, catLabel }: { r: any; catLabel: (c: string) => string }) {
  const k = r.k
  const [cat, setCat] = useState('all')
  const byQ = useMemo(() => {
    const m = new Map<string, any[]>()
    for (const row of r.rows) m.set(row.question_id, [...(m.get(row.question_id) ?? []), row])
    return [...m.entries()]
  }, [r])
  const panes: any[] = r.pipelines
  const open = (q: string) => {
    const a = useApp.getState()
    a.setQuestion(q)
    setTimeout(() => a.runPanes(), 0)
  }
  const filtered = byQ.filter(([, rows]) => cat === 'all' || rows[0].category === cat)
  return (
    <section className="rounded-xl border border-line bg-surface p-3">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Per-question drill-down</h3>
        <Select className="ml-auto w-48" value={cat} onChange={setCat} options={[{ value: 'all', label: 'All categories' }, ...Object.keys(r.by_category).map((c) => ({ value: c, label: catLabel(c) }))]} />
      </div>
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-surface text-left text-[10.5px] uppercase tracking-wider text-subtle">
            <tr><th className="w-7" /><th className="pb-1">Question</th>{panes.map((p) => <th key={p.id} className={`pane-${p.id} pb-1 text-center text-pc`}>{p.id}</th>)}</tr>
          </thead>
          <tbody>
            {filtered.map(([qid, rows]) => (
              <tr key={qid} className="border-t border-line/60 align-top">
                <td className="py-1.5"><Tip content="Open the full trace in the panes (re-runs this question)"><button onClick={() => open(rows[0].question)} className="rounded p-1 text-accent hover:bg-accent/15"><Play className="h-3 w-3" /></button></Tip></td>
                <td className="py-1.5 pr-2">
                  <div className="leading-snug">{rows[0].question}</div>
                  <div className="text-[10.5px] text-subtle">{catLabel(rows[0].category)} · gold {rows[0].gold_chunks.join(', ') || '—'}</div>
                </td>
                {panes.map((p) => {
                  const x = rows.find((y: any) => y.pane === p.id)
                  if (!x) return <td key={p.id} />
                  const hit = x[`hit@${k}`]
                  return (
                    <td key={p.id} className={`pane-${p.id} px-1 py-1.5 text-center`}>
                      <Tip content={<div className="max-w-xs space-y-1"><div className="text-muted">retrieved: {x.retrieved.join(', ')}</div>{x.judge?.rationale && <div className="text-subtle">{x.judge.rationale}</div>}<div>{(x.answer || '').slice(0, 300)}</div></div>}>
                        <div className="inline-flex cursor-help flex-col items-center gap-0.5">
                          {hit === undefined ? <Badge>n/a</Badge> : <Badge tone={hit ? 'good' : 'bad'}>{hit ? 'hit' : 'miss'}</Badge>}
                          {x.judge?.correctness !== undefined && x.judge?.correctness !== null && <span className="num text-[10.5px] text-muted">{Number(x.judge.correctness).toFixed(1)}/5</span>}
                          {x.error && <span className="text-[10px] text-bad">error</span>}
                        </div>
                      </Tip>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
