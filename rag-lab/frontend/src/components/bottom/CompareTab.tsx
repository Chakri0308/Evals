import { useMemo, useState } from 'react'
import { GitCompare } from 'lucide-react'
import { useApp, visiblePanes } from '@/store/app'
import type { PaneId } from '@/lib/types'
import { cn, findComponent, fmtMs } from '@/lib/utils'
import { Empty, Segmented, Tip } from '@/components/ui'

export function CompareTab() {
  const vis = useApp(visiblePanes)
  const runs = useApp((s) => s.runs)
  const panes = useApp((s) => s.panes)
  const done = vis.filter((p) => runs[p].result)
  if (done.length < 1) return <Empty icon={<GitCompare className="h-4 w-4" />} title="Nothing to compare yet">Run a question across the panes. Overlap, Jaccard, answer diffs and metrics appear here.</Empty>
  const sets = Object.fromEntries(done.map((p) => [p, new Set(runs[p].result!.hits.map((h) => h.chunk_id))])) as Record<PaneId, Set<string>>
  return (
    <div className="h-full min-h-0 space-y-3 overflow-y-auto p-3">
      <Card title="All answers side by side"><AllAnswers ids={done} /></Card>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        <Card title="Retrieved-chunk overlap">
          <div className="flex flex-wrap items-start gap-4">
            <Venn ids={done} sets={sets} names={Object.fromEntries(done.map((p) => [p, panes[p].name]))} />
            <Jaccard ids={done} sets={sets} />
          </div>
        </Card>
        <Card title="Chunk × pane matrix (rank in each pane's final context)"><Matrix ids={done} /></Card>
      </div>
      <div className="space-y-3">
        <Card title="Side-by-side metrics"><Metrics ids={done} /></Card>
        {done.length >= 2 && <Card title="Answer diff (word-level)"><AnswerDiff ids={done} /></Card>}
      </div>
      </div>
    </div>
  )

  function Card({ title, children }: { title: string; children: React.ReactNode }) {
    return (
      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <h3 className="mb-3"><span className="label-box">{title}</span></h3>
        {children}
      </section>
    )
  }
}

const inter = (a: Set<string>, b: Set<string>) => new Set([...a].filter((x) => b.has(x)))

function Venn({ ids, sets, names }: { ids: PaneId[]; sets: Record<PaneId, Set<string>>; names: Record<string, string> }) {
  const [hov, setHov] = useState<string | null>(null)
  const all = new Set(ids.flatMap((p) => [...sets[p]]))
  const regions = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const c of all) {
      const key = ids.filter((p) => sets[p].has(c)).join('')
      m.set(key, [...(m.get(key) ?? []), c])
    }
    return m
  }, [ids, sets]) // eslint-disable-line react-hooks/exhaustive-deps
  const pos3: Record<string, [number, number]> = { A: [78, 70], B: [142, 70], C: [110, 126] }
  const pos2: Record<string, [number, number]> = { A: [85, 92], B: [135, 92], C: [135, 92] }
  const pos1: Record<string, [number, number]> = { A: [110, 92], B: [110, 92], C: [110, 92] }
  const pos = ids.length === 3 ? pos3 : ids.length === 2 ? pos2 : pos1
  const R = ids.length === 1 ? 60 : 52
  // label centroid for each region key
  const centroid = (key: string): [number, number] => {
    const ps = key.split('') as PaneId[]
    const out = ids.filter((p) => !ps.includes(p))
    let x = ps.reduce((s, p) => s + pos[p][0], 0) / ps.length
    let y = ps.reduce((s, p) => s + pos[p][1], 0) / ps.length
    if (ps.length === 1 && ids.length > 1) {
      const cx = ids.reduce((s, p) => s + pos[p][0], 0) / ids.length, cy = ids.reduce((s, p) => s + pos[p][1], 0) / ids.length
      x += (x - cx) * 0.75; y += (y - cy) * 0.75
    } else if (out.length && ps.length > 1) {
      const o = pos[out[0]]
      x += (x - o[0]) * 0.35; y += (y - o[1]) * 0.35
    }
    return [x, y]
  }
  const regionLabel = (k: string) => k.split('').join(' ∩ ') + (k.length === 1 ? ' only' : '')
  return (
    <div className="flex items-start gap-3">
      <svg viewBox="0 0 220 190" className="w-[220px] shrink-0">
        {ids.map((p) => (
          <circle key={p} cx={pos[p][0]} cy={pos[p][1]} r={R} className={`pane-${p}`}
            fill="rgb(var(--pc) / 0.16)" stroke="rgb(var(--pc))" strokeWidth={2} />
        ))}
        {ids.map((p) => {
          const [x, y] = pos[p]
          const ly = ids.length === 3 && p === 'C' ? y + R + 11 : y - R - 5
          return <text key={'l' + p} x={x} y={ly} textAnchor="middle" fontSize="10" fontWeight={600} fill="rgb(var(--fg))">{p} · {names[p]}</text>
        })}
        {[...regions.entries()].map(([k, v]) => {
          const [x, y] = centroid(k)
          return (
            <g key={k} onMouseEnter={() => setHov(k)} onMouseLeave={() => setHov(null)} className="cursor-default">
              <circle cx={x} cy={y} r={11} fill="transparent" />
              <text x={x} y={y + 4} textAnchor="middle" fontSize="12" fontWeight={hov === k ? 700 : 600} fill="rgb(var(--fg))" fontFamily="JetBrains Mono">{v.length}</text>
            </g>
          )
        })}
      </svg>
      <div className="min-w-[150px] space-y-1 pt-1 text-[11.5px]">
        {[...regions.entries()].sort((a, b) => b[0].length - a[0].length).map(([k, v]) => (
          <div key={k} onMouseEnter={() => setHov(k)} onMouseLeave={() => setHov(null)}
            className={cn('rounded-md px-1.5 py-0.5', hov === k && 'bg-elevated')}>
            <span className="font-medium text-muted">{regionLabel(k)}</span>
            <span className="num ml-1.5 text-fg">{v.sort((a, b) => +a.slice(1) - +b.slice(1)).join(', ')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Jaccard({ ids, sets }: { ids: PaneId[]; sets: Record<PaneId, Set<string>> }) {
  if (ids.length < 2) return null
  const j = (a: PaneId, b: PaneId) => {
    const i = inter(sets[a], sets[b]).size
    const u = new Set([...sets[a], ...sets[b]]).size
    return u ? i / u : 0
  }
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-muted">Jaccard similarity</div>
      <table className="num text-[11.5px]">
        <thead><tr><th />{ids.map((p) => <th key={p} className={`pane-${p} px-2 py-1 text-pc`}>{p}</th>)}</tr></thead>
        <tbody>
          {ids.map((a) => (
            <tr key={a}>
              <td className={`pane-${a} pr-2 font-semibold text-pc`}>{a}</td>
              {ids.map((b) => {
                const v = j(a, b)
                return <td key={b} className="px-1 py-0.5"><div className="rounded-md px-2 py-1 text-center text-fg" style={{ background: `rgb(var(--accent) / ${a === b ? 0.06 : 0.08 + v * 0.45})` }}>{a === b ? '—' : v.toFixed(2)}</div></td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Matrix({ ids }: { ids: PaneId[] }) {
  const runs = useApp((s) => s.runs)
  const focus = useApp((s) => s.focusChunk)
  const rows = useMemo(() => {
    const m = new Map<string, Record<string, { rank: number; cited: boolean }>>()
    for (const p of ids) {
      const r = runs[p].result!
      r.hits.forEach((h, i) => {
        const e = m.get(h.chunk_id) ?? {}
        e[p] = { rank: i + 1, cited: r.cited.includes(h.chunk_id) }
        m.set(h.chunk_id, e)
      })
    }
    return [...m.entries()].sort((a, b) => Object.keys(b[1]).length - Object.keys(a[1]).length || Math.min(...Object.values(a[1]).map((x) => x.rank)) - Math.min(...Object.values(b[1]).map((x) => x.rank)))
  }, [ids, runs])
  const chunkOf = (id: string) => ids.map((p) => runs[p].result!.chunks[id]).find(Boolean)
  return (
    <div className="max-h-[300px] overflow-auto">
      <table className="w-full text-[11.5px]">
        <thead className="sticky top-0 bg-surface">
          <tr className="text-left text-subtle">
            <th className="py-1 pr-2 font-medium">Chunk</th><th className="pr-2 font-medium">Location</th>
            {ids.map((p) => <th key={p} className={`pane-${p} w-12 text-center font-semibold text-pc`}>{p}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(([id, e]) => {
            const c = chunkOf(id)
            return (
              <tr key={id} className="border-t border-line/60">
                <td className="num py-1 pr-2 font-semibold">{id}</td>
                <td className="max-w-[220px] truncate pr-2 text-muted" title={c?.heading_path.join(' › ')}>{c?.heading_path.slice(-1)[0] ?? (c?.page ? `p.${c.page}` : '')}</td>
                {ids.map((p) => (
                  <td key={p} className={`pane-${p} py-0.5 text-center`}>
                    {e[p] ? (
                      <Tip content={`Rank #${e[p].rank} in pane ${p}${e[p].cited ? ' · cited' : ''} (click to jump)`}>
                        <button onClick={() => focus(p, id)} className={cn('num inline-flex h-5 min-w-7 items-center justify-center rounded px-1 text-[10.5px] font-semibold',
                          e[p].cited ? 'bg-pc text-white' : 'bg-pc-soft text-pc')}>#{e[p].rank}</button>
                      </Tip>
                    ) : <span className="text-subtle/50">·</span>}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="mt-1.5 text-[10.5px] text-subtle">Filled = cited in that pane's answer · light = in context, not cited</div>
    </div>
  )
}

function Metrics({ ids }: { ids: PaneId[] }) {
  const runs = useApp((s) => s.runs)
  const panes = useApp((s) => s.panes)
  const reg = useApp((s) => s.registry)
  const rows: [string, (p: PaneId) => React.ReactNode][] = [
    ['Retrieval', (p) => panes[p].stages.retrieval.enabled ? findComponent(reg, 'retrieval', panes[p].stages.retrieval.component)?.label : 'off (closed-book)'],
    ['Chunker', (p) => `${panes[p].stages.chunking.component} · ${panes[p].stages.chunking.params.chunk_size_tokens ?? '–'}`],
    ['Rerank', (p) => panes[p].stages.rerank.enabled ? panes[p].stages.rerank.component : 'off'],
    ['Model', (p) => panes[p].stages.generation.enabled ? (panes[p].stages.generation.params.model ?? panes[p].stages.generation.component) : 'off'],
    ['Context chunks', (p) => runs[p].result!.hits.length],
    ['Context tokens', (p) => runs[p].result!.hits.reduce((s, h) => s + (runs[p].result!.chunks[h.chunk_id]?.tokens ?? 0), 0)],
    ['Cited', (p) => { const r = runs[p].result!; const valid = r.cited.filter((c) => r.hits.some((h) => h.chunk_id === c)); return `${valid.length}${r.cited.length !== valid.length ? ` (+${r.cited.length - valid.length} invalid)` : ''}` }],
    ['Abstained', (p) => /i (do not|don't) know/i.test(runs[p].result!.answer) ? 'yes' : 'no'],
    ['Latency', (p) => fmtMs(runs[p].result!.total_ms)],
    ['Generation', (p) => fmtMs(runs[p].result!.timings.generation)],
    ['Tokens in / out', (p) => `${runs[p].result!.usage.input_tokens} / ${runs[p].result!.usage.output_tokens}`],
    ['Cost', (p) => `$${runs[p].result!.usage.cost_usd.toFixed(4)}`],
  ]
  return (
    <table className="w-full text-[12px]">
      <thead><tr className="text-left"><th />{ids.map((p) => <th key={p} className={`pane-${p} pb-1.5 font-semibold`}><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-pc" />{panes[p].name}</span></th>)}</tr></thead>
      <tbody>
        {rows.map(([k, f]) => (
          <tr key={k} className="border-t border-line/60">
            <td className="py-1 pr-3 text-muted">{k}</td>
            {ids.map((p) => <td key={p} className="num py-1 pr-2 text-fg">{f(p)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function wordDiff(a: string, b: string) {
  const A = a.split(/(\s+)/).filter(Boolean), B = b.split(/(\s+)/).filter(Boolean)
  const n = A.length, m = B.length
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: { t: string; k: 'same' | 'add' | 'del' }[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: A[i], k: 'same' }); i++; j++ } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: A[i++], k: 'del' })
    else out.push({ t: B[j++], k: 'add' })
  }
  while (i < n) out.push({ t: A[i++], k: 'del' })
  while (j < m) out.push({ t: B[j++], k: 'add' })
  return out
}

function AnswerDiff({ ids }: { ids: PaneId[] }) {
  const runs = useApp((s) => s.runs)
  const [l, setL] = useState<PaneId>(ids[0])
  const [r, setR] = useState<PaneId>(ids[1])
  const d = useMemo(() => wordDiff(runs[l]?.result?.answer ?? '', runs[r]?.result?.answer ?? ''), [l, r, runs])
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs text-muted">
        <Segmented size="xs" value={l} onChange={setL} options={ids.map((p) => ({ value: p, label: p }))} />
        vs
        <Segmented size="xs" value={r} onChange={setR} options={ids.map((p) => ({ value: p, label: p }))} />
        <span className="ml-auto flex gap-2 text-[11px]"><span className="rounded bg-bad/15 px-1 text-bad line-through">only {l}</span><span className="rounded bg-good/15 px-1 text-good">only {r}</span></span>
      </div>
      <div className="max-h-[260px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-bg/50 p-2.5 text-[12.5px] leading-relaxed">
        {d.map((x, i) => (
          <span key={i} className={x.k === 'add' ? 'rounded-sm bg-good/15 text-good' : x.k === 'del' ? 'rounded-sm bg-bad/15 text-bad line-through decoration-bad/50' : 'text-fg/85'}>{x.t}</span>
        ))}
      </div>
    </div>
  )
}

function AllAnswers({ ids }: { ids: PaneId[] }) {
  const runs = useApp((s) => s.runs)
  const panes = useApp((s) => s.panes)
  const reg = useApp((s) => s.registry)
  const focus = useApp((s) => s.focusChunk)
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${ids.length}, minmax(0, 1fr))` }}>
      {ids.map((p) => {
        const r = runs[p].result!
        const cfg = panes[p]
        const ret = cfg.stages.retrieval.enabled ? findComponent(reg, 'retrieval', cfg.stages.retrieval.component)?.label : 'closed-book'
        return (
          <div key={p} className={`pane-${p} rounded-lg border border-pc bg-bg/40 p-2.5`}>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px]">
              <span className="flex h-4 w-4 items-center justify-center rounded bg-pc text-[10px] font-bold text-white">{p}</span>
              <span className="font-semibold">{cfg.name}</span>
              <span className="truncate text-subtle">· {ret}</span>
              <span className="num ml-auto text-subtle">{fmtMs(r.total_ms)}</span>
            </div>
            <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-fg/90">
              {r.error ? <span className="text-bad">{r.error.stage}: {r.error.message}</span>
                : r.not_ready ? <span className="text-warn">Not ready yet: waiting for {r.not_ready.missing.map((m) => m === 'embedder' ? 'an embedding model' : 'a vector DB').join(' and ')}.</span>
                : (r.answer || runs[p].answer || <span className="text-subtle">no answer (generation off)</span>)}
              {r.answer_source?.kind === 'extractive_fallback' && <div className="mt-1 text-[10.5px] text-accent">no-LLM answer (extractive)</div>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1 border-t border-line/60 pt-1.5">
              <span className="text-[10.5px] text-subtle">used:</span>
              {r.hits.map((h) => (
                <button key={h.chunk_id} onClick={() => focus(p, h.chunk_id)}
                  className={cn('num rounded px-1 text-[10.5px]', r.cited.includes(h.chunk_id) ? 'bg-pc text-white' : 'bg-pc-soft text-pc')}>{h.chunk_id}</button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
