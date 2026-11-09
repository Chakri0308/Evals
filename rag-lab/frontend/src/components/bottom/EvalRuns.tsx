import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowRight, ArrowUp, Check, FolderOpen, GitCompareArrows, Loader2, Pencil, Trash2 } from 'lucide-react'
import { api, del } from '@/api/client'
import { cn, fmtMs } from '@/lib/utils'
import { Badge, Button, Empty, Segmented, Select, Tip } from '@/components/ui'

export interface EvalSummary {
  id: string
  label: string
  created: number
  doc_id: string
  n: number
  k: number
  duration_s: number
  judge: string
  questions: number
  pipelines: string[]
  leaderboard: Record<string, any>[]
}

function useEvalRuns(docId: string | null | undefined) {
  return useQuery({
    queryKey: ['evals', docId],
    queryFn: () => api<EvalSummary[]>(`/api/evals?doc_id=${encodeURIComponent(docId!)}`),
    enabled: !!docId,
  })
}

const when = (t: number) => new Date(t * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const runName = (r: { id: string; label?: string; created: number }) => r.label || `Run ${when(r.created)}`

/** Saved eval runs for this document: open one, rename, delete, or pick two to compare. */
export function RunsView({ docId, onOpen }: { docId: string; onOpen: (rec: any) => void }) {
  const { data, isLoading } = useEvalRuns(docId)
  const qc = useQueryClient()
  const [pickedBase, setBase] = useState<string | null>(null)
  const [pickedCand, setCand] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [opening, setOpening] = useState<string | null>(null)
  const runs = useMemo(() => data ?? [], [data])
  // default comparison: the two most recent runs (older = baseline); a pick that was deleted falls back too
  const exists = (id: string | null) => !!id && runs.some((r) => r.id === id)
  const base = exists(pickedBase) ? pickedBase : runs[1]?.id ?? null
  const cand = exists(pickedCand) ? pickedCand : runs[0]?.id ?? null

  const refresh = () => qc.invalidateQueries({ queryKey: ['evals', docId] })
  const open = async (id: string) => {
    setOpening(id)
    try { onOpen(await api(`/api/evals/${encodeURIComponent(id)}`)) } finally { setOpening(null) }
  }
  const rename = async (id: string) => {
    await api(`/api/evals/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ label }) })
    setEditing(null); refresh()
  }
  const remove = async (id: string) => {
    await del(`/api/evals/${encodeURIComponent(id)}`)
    refresh()
  }

  if (isLoading) return <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading runs…</div>
  if (!runs.length) return <Empty icon={<FolderOpen className="h-4 w-4" />} title="No saved runs">Every Batch Eval is saved automatically. Run one and it shows up here, ready to compare with the next.</Empty>

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Saved runs</h3>
          <span className="text-[11px] text-subtle">pick a <b className="text-muted">baseline</b> and a <b className="text-muted">candidate</b> to compare</span>
        </div>
        <div className="max-h-[260px] overflow-y-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-surface text-left text-[10.5px] uppercase tracking-wider text-subtle">
              <tr><th className="px-3 py-1.5">Run</th><th className="px-2">Configs</th><th className="px-2 text-right">Qs</th><th className="px-2">Headline (best config)</th><th className="px-2 text-center">Base</th><th className="px-2 text-center">Cand</th><th className="w-24" /></tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const top = r.leaderboard[0]
                const recall = top?.[`recall@${r.k}`]
                return (
                  <tr key={r.id} className="border-t border-line/60">
                    <td className="px-3 py-1.5">
                      {editing === r.id ? (
                        <form onSubmit={(e) => { e.preventDefault(); rename(r.id) }} className="flex gap-1">
                          <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => rename(r.id)} maxLength={120} placeholder={runName(r)}
                            className="h-6 w-44 rounded border border-line bg-surface px-1.5 text-[12px] focus:border-accent/70 focus:outline-none" />
                        </form>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="font-medium text-fg">{runName(r)}</span>
                          <button onClick={() => { setEditing(r.id); setLabel(r.label) }} className="rounded p-0.5 text-subtle hover:text-fg" aria-label="Rename"><Pencil className="h-2.5 w-2.5" /></button>
                        </div>
                      )}
                      <div className="text-[10.5px] text-subtle">{r.label ? `${when(r.created)} · ` : ''}k={r.k} · judge {r.judge} · {r.duration_s}s</div>
                    </td>
                    <td className="px-2 py-1.5 text-muted">{r.pipelines.join(' · ')}</td>
                    <td className="num px-2 py-1.5 text-right text-muted">{r.questions}</td>
                    <td className="px-2 py-1.5 text-muted">
                      {top ? <span><span className="text-fg">{top.pipeline}</span> · <span className="num">R@{r.k} {recall == null ? '–' : `${Math.round(recall * 100)}%`} · MRR {top.mrr == null ? '–' : top.mrr.toFixed(2)}</span></span> : '–'}
                    </td>
                    <td className="px-2 py-1.5 text-center"><input type="radio" name="base" checked={base === r.id} onChange={() => setBase(r.id)} aria-label="Baseline" className="accent-[rgb(var(--accent))]" /></td>
                    <td className="px-2 py-1.5 text-center"><input type="radio" name="cand" checked={cand === r.id} onChange={() => setCand(r.id)} aria-label="Candidate" className="accent-[rgb(var(--accent))]" /></td>
                    <td className="px-2 py-1.5">
                      <div className="flex justify-end gap-0.5">
                        <Button size="sm" variant="ghost" onClick={() => open(r.id)} disabled={opening === r.id}>{opening === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Open'}</Button>
                        <Tip content="Delete run"><Button size="iconSm" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-3 w-3" /></Button></Tip>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
      {base && cand && base !== cand ? <Compare baseId={base} candId={cand} />
        : <div className="rounded-xl border border-dashed border-line p-4 text-center text-xs text-muted">{runs.length < 2 ? 'Run one more evaluation to compare two runs.' : 'Pick two different runs to compare.'}</div>}
    </div>
  )
}

const useEvalRecord = (id: string) => useQuery({ queryKey: ['eval', id], queryFn: () => api<any>(`/api/evals/${encodeURIComponent(id)}`), staleTime: Infinity })
const qkey = (row: any) => String(row.question ?? row.question_id).trim().toLowerCase()

type Change = 'regressed' | 'fixed' | 'same'

/** Baseline vs. candidate: per-metric deltas for one config from each run, and which questions got better or worse. */
function Compare({ baseId, candId }: { baseId: string; candId: string }) {
  const b = useEvalRecord(baseId)
  const c = useEvalRecord(candId)
  const [pickedBp, setBp] = useState<string>('')
  const [pickedCp, setCp] = useState<string>('')
  const [show, setShow] = useState<Change | 'all'>('regressed')

  // default config pairing: same name if both runs have it, else the top of each leaderboard
  const pairing = useMemo(() => {
    if (!b.data || !c.data) return { bp: '', cp: '' }
    const names = new Set(c.data.pipelines.map((p: any) => p.name))
    const shared = b.data.leaderboard.find((e: any) => names.has(e.pipeline))
    return {
      bp: shared ? shared.pane : b.data.leaderboard[0]?.pane ?? '',
      cp: (shared ? c.data.leaderboard.find((e: any) => e.pipeline === shared.pipeline)?.pane : c.data.leaderboard[0]?.pane) ?? '',
    }
  }, [b.data, c.data])
  const has = (rec: any, pane: string) => !!pane && rec?.leaderboard.some((e: any) => e.pane === pane)
  const bp = has(b.data, pickedBp) ? pickedBp : pairing.bp
  const cp = has(c.data, pickedCp) ? pickedCp : pairing.cp

  const diff = useMemo(() => {
    if (!b.data || !c.data || !bp || !cp) return null
    const k = b.data.k
    const sameK = b.data.k === c.data.k
    const bRows = new Map<string, any>(b.data.rows.filter((r: any) => r.pane === bp).map((r: any) => [qkey(r), r]))
    const cRows = new Map<string, any>(c.data.rows.filter((r: any) => r.pane === cp).map((r: any) => [qkey(r), r]))
    const qs: { key: string; b: any; c: any; change: Change; why: string }[] = []
    for (const [key, br] of bRows) {
      const cr = cRows.get(key)
      if (!cr) continue
      const bh = br[`hit@${b.data.k}`], ch = cr[`hit@${c.data.k}`]
      const bc = br.judge?.correctness, cc = cr.judge?.correctness
      let change: Change = 'same', why = ''
      if (sameK && bh !== undefined && ch !== undefined && bh !== ch) { change = ch ? 'fixed' : 'regressed'; why = ch ? 'now retrieves the gold chunk' : 'lost the gold chunk' }
      else if (bc != null && cc != null && Math.abs(cc - bc) >= 1) { change = cc > bc ? 'fixed' : 'regressed'; why = `correctness ${bc.toFixed(1)} → ${cc.toFixed(1)}` }
      qs.push({ key, b: br, c: cr, change, why })
    }
    const be = b.data.leaderboard.find((e: any) => e.pane === bp) ?? {}
    const ce = c.data.leaderboard.find((e: any) => e.pane === cp) ?? {}
    const metrics: [string, string, 'pct' | 'num' | 'ms', boolean][] = [
      ...(sameK ? [[`hit@${k}`, `Hit@${k}`, 'pct', true], [`recall@${k}`, `Recall@${k}`, 'pct', true], [`ndcg@${k}`, `nDCG@${k}`, 'num', true]] as [string, string, 'pct' | 'num' | 'ms', boolean][] : []),
      ['mrr', 'MRR', 'num', true], ['correctness', 'Correctness', 'num', true], ['faithfulness', 'Faithfulness', 'num', true],
      ['citation_accuracy', 'Citation acc.', 'pct', true], ['abstention_acc', 'Abstention', 'pct', true],
      ['latency_p50', 'Latency p50', 'ms', false], ['latency_p95', 'Latency p95', 'ms', false],
    ]
    return { qs, be, ce, metrics, sameK, unmatched: bRows.size + cRows.size - 2 * qs.length }
  }, [b.data, c.data, bp, cp])

  if (b.isLoading || c.isLoading || !diff) return <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading runs…</div>
  const fmt = (v: any, kind: string) => v == null ? '–' : kind === 'pct' ? `${Math.round(v * 100)}%` : kind === 'ms' ? fmtMs(v) : v.toFixed(2)
  const fmtD = (d: number, kind: string) => (d > 0 ? '+' : '') + (kind === 'pct' ? `${Math.round(d * 100)} pts` : kind === 'ms' ? fmtMs(d) : d.toFixed(2))
  const counts = { regressed: diff.qs.filter((q) => q.change === 'regressed').length, fixed: diff.qs.filter((q) => q.change === 'fixed').length, same: diff.qs.filter((q) => q.change === 'same').length }
  const list = diff.qs.filter((q) => show === 'all' || q.change === show)

  return (
    <section className="rounded-xl border border-line bg-surface p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <GitCompareArrows className="h-3.5 w-3.5 text-subtle" />
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Compare</h3>
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="text-muted">{runName(b.data)}</span>
          <Select className="w-40" value={bp} onChange={setBp} options={b.data.leaderboard.map((e: any) => ({ value: e.pane, label: e.pipeline }))} />
          <ArrowRight className="h-3 w-3 text-subtle" />
          <span className="text-muted">{runName(c.data)}</span>
          <Select className="w-40" value={cp} onChange={setCp} options={c.data.leaderboard.map((e: any) => ({ value: e.pane, label: e.pipeline }))} />
        </div>
      </div>
      {!diff.sameK && <div className="mb-2 text-[11px] text-warn">The runs used different k ({b.data.k} vs {c.data.k}), so the @k metrics and hit/miss changes are left out.</div>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        {diff.metrics.map(([key, label, kind, higher]) => {
          const bv = diff.be[key], cv = diff.ce[key]
          const d = bv != null && cv != null ? cv - bv : null
          const better = d === null || Math.abs(d) < 1e-9 ? null : higher ? d > 0 : d < 0
          return (
            <div key={key} className="rounded-lg border border-line px-2.5 py-2">
              <div className="text-[10.5px] text-subtle">{label}</div>
              <div className="num mt-0.5 flex items-baseline gap-1.5 text-[13px]">
                <span className="text-muted">{fmt(bv, kind)}</span><ArrowRight className="h-2.5 w-2.5 self-center text-subtle" /><span className="font-semibold text-fg">{fmt(cv, kind)}</span>
              </div>
              {d !== null && (
                <div className={cn('num mt-0.5 inline-flex items-center gap-0.5 text-[11px]', better === null ? 'text-subtle' : better ? 'text-good' : 'text-bad')}>
                  {better !== null && (d > 0 ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />)}{better === null ? 'no change' : fmtD(d, kind)}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="mb-2 mt-4 flex flex-wrap items-center gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Per question</h4>
        <span className="text-[11px] text-subtle">{diff.qs.length} questions in both runs{diff.unmatched > 0 ? ` · ${diff.unmatched} only in one` : ''}</span>
        <Segmented className="ml-auto" size="xs" value={show} onChange={setShow} options={[
          { value: 'regressed', label: `Regressed ${counts.regressed}` }, { value: 'fixed', label: `Fixed ${counts.fixed}` },
          { value: 'same', label: `Unchanged ${counts.same}` }, { value: 'all', label: 'All' },
        ]} />
      </div>
      {!list.length ? <div className="py-4 text-center text-xs text-subtle">{show === 'regressed' ? 'No regressions.' : 'Nothing here.'}</div> : (
        <div className="max-h-[320px] overflow-y-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-surface text-left text-[10.5px] uppercase tracking-wider text-subtle">
              <tr><th className="py-1">Question</th><th className="px-2 text-center">Baseline</th><th className="px-2 text-center">Candidate</th><th className="px-2">Change</th></tr>
            </thead>
            <tbody>
              {list.map((q) => (
                <tr key={q.key} className="border-t border-line/60 align-top">
                  <td className="py-1.5 pr-2 leading-snug">{q.b.question}<div className="text-[10.5px] text-subtle">{q.b.category}</div></td>
                  {[q.b, q.c].map((r, i) => {
                    const hit = r[`hit@${i ? c.data.k : b.data.k}`]
                    return (
                      <td key={i} className="px-2 py-1.5 text-center">
                        <Tip content={<div className="max-w-xs space-y-1"><div className="text-muted">retrieved: {r.retrieved.join(', ')}</div><div>{(r.answer || '').slice(0, 300)}</div></div>}>
                          <div className="inline-flex cursor-help flex-col items-center gap-0.5">
                            {hit === undefined ? <Badge>n/a</Badge> : <Badge tone={hit ? 'good' : 'bad'}>{hit ? 'hit' : 'miss'}</Badge>}
                            {r.judge?.correctness != null && <span className="num text-[10.5px] text-muted">{Number(r.judge.correctness).toFixed(1)}/5</span>}
                          </div>
                        </Tip>
                      </td>
                    )
                  })}
                  <td className="px-2 py-1.5">
                    {q.change === 'same' ? <span className="text-subtle">–</span>
                      : <span className={cn('inline-flex items-center gap-1 text-[11.5px]', q.change === 'fixed' ? 'text-good' : 'text-bad')}>{q.change === 'fixed' ? <Check className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{q.why}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
