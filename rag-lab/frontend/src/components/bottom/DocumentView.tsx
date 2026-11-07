import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Loader2 } from 'lucide-react'
import { post } from '@/api/client'
import { useDoc } from '@/api/hooks'
import { useApp, visiblePanes } from '@/store/app'
import type { PaneId, StageConfig } from '@/lib/types'
import { cn, deepClone, effectiveParams, findComponent, stableStringify } from '@/lib/utils'
import { Badge, Button, Empty, Segmented, Select, Skeleton, Switch } from '@/components/ui'
import { SchemaForm } from '@/components/schema/SchemaForm'

interface PChunk { id: string; start: number; end: number; tokens: number; page?: number | null; heading_path: string[] }
interface Preview { key: string; cache_hit: boolean; ms: number; stats: { count: number; avg: number; min: number; max: number; total: number }; chunks: PChunk[] }

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v)
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms])
  return d
}

export function DocumentView() {
  const docId = useApp((s) => s.docId)
  const reg = useApp((s) => s.registry)
  const panes = useApp((s) => s.panes)
  const vis = useApp(visiblePanes)
  const docFocus = useApp((s) => s.docFocus)
  const a = useApp.getState()
  const { data: doc } = useDoc(docId)
  const [src, setSrc] = useState<PaneId>('A')
  const [cfg, setCfg] = useState<StageConfig>(() => deepClone(panes.A.stages.chunking))
  const [hover, setHover] = useState<number | null>(null)
  const [showBands, setShowBands] = useState(true)
  const [applied, setApplied] = useState(false)

  // follow the pane chosen via "Show in document"
  useEffect(() => {
    if (docFocus) { setSrc(docFocus.pane); setCfg(deepClone(useApp.getState().panes[docFocus.pane].stages.chunking)) }
  }, [docFocus])

  const dcfg = useDebounced(cfg, 300)
  const { data: pv, isFetching, error } = useQuery({
    queryKey: ['preview', docId, stableStringify(dcfg)],
    enabled: !!docId,
    placeholderData: (p) => p,
    queryFn: () => post<Preview>('/api/chunk/preview', { doc_id: docId, chunking: dcfg }),
  })

  const paneCfg = panes[src].stages.chunking
  const dirty = stableStringify(paneCfg) !== stableStringify(cfg)
  const comps = reg?.stages.find((s) => s.stage === 'chunking')?.components ?? []
  const comp = findComponent(reg, 'chunking', cfg.component)
  const focusIdx = docFocus && pv && !dirty ? pv.chunks.findIndex((c) => c.id === docFocus.chunkId) : -1

  if (!docId) return <Empty title="No document">Upload a style guide to see how it is chunked.</Empty>

  return (
    <div className="flex h-full min-h-0">
      <aside className="@container w-[320px] shrink-0 overflow-y-auto border-r border-line p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Chunking preview</span>
          {isFetching && <Loader2 className="h-3 w-3 animate-spin text-subtle" />}
        </div>
        <div className="mb-2 flex items-center gap-2 text-xs text-muted">
          From pane
          <Segmented size="xs" value={src} onChange={(p) => { setSrc(p); setCfg(deepClone(panes[p].stages.chunking)) }}
            options={vis.map((p) => ({ value: p, label: p }))} />
          {dirty && <Badge tone="warn">edited</Badge>}
        </div>
        <div className="mb-2 flex items-center gap-2">
          <Switch size="sm" checked={cfg.enabled} onCheckedChange={(v) => setCfg({ ...cfg, enabled: v })} />
          <Select className="flex-1" value={cfg.component} onChange={(v) => setCfg({ ...cfg, component: v, params: Object.fromEntries(Object.entries(cfg.params).filter(([k]) => findComponent(reg, 'chunking', v)?.schema.properties?.[k])) })}
            options={comps.map((c) => ({ value: c.name, label: c.label, hint: c.description }))} />
        </div>
        <SchemaForm dense schema={comp?.schema} values={effectiveParams(reg, 'chunking', cfg.component, cfg.params)} explicit={cfg.params}
          onChange={(k, v) => setCfg({ ...cfg, params: { ...cfg.params, [k]: v } })}
          onReset={(k) => { const { [k]: _x, ...r } = cfg.params; setCfg({ ...cfg, params: r }) }} />
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button size="sm" disabled={!dirty} onClick={() => { a.replacePane(src, { ...panes[src], stages: { ...panes[src].stages, chunking: deepClone(cfg) } }); flash() }}>Apply to pane {src}</Button>
          <Button size="sm" onClick={() => { a.applyChunkingToAll(cfg); flash() }}>Apply to all panes</Button>
          {applied && <span className="flex items-center gap-1 text-[11px] text-good"><Check className="h-3 w-3" />applied</span>}
        </div>
        {error && <div className="mt-2 text-[11px] text-bad">{String((error as Error).message)}</div>}
        {pv && (
          <>
            <div className="mt-4 grid grid-cols-4 gap-1.5">
              {[['chunks', pv.stats.count], ['avg', pv.stats.avg], ['min', pv.stats.min], ['max', pv.stats.max]].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-line bg-surface px-2 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-subtle">{k}</div>
                  <div className="num text-[13px] font-semibold">{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-1 text-[10.5px] text-subtle">
              <span className="num">{pv.ms}ms</span> · cache {pv.cache_hit ? 'hit' : 'miss'} · <span className="num">{pv.key}</span>
            </div>
            <Histogram chunks={pv.chunks} max={Number(effectiveParams(reg, 'chunking', cfg.component, cfg.params).chunk_size_tokens ?? pv.stats.max)} />
          </>
        )}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-line px-3 py-1.5 text-[11px] text-muted">
          <span className="truncate font-medium text-fg">{doc?.name}</span>
          <label className="flex items-center gap-1.5">bands <Switch size="sm" checked={showBands} onCheckedChange={setShowBands} /></label>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm bg-[rgb(var(--pc)/0.14)]" />chunk</span>
          <span className="flex items-center gap-1"><span className="band-stripe inline-block h-2.5 w-4 rounded-sm bg-[rgb(var(--pc)/0.3)]" />overlap</span>
          {hover !== null && pv && <span className="num ml-auto text-fg">{pv.chunks[hover].id} · {pv.chunks[hover].tokens} tok · {pv.chunks[hover].heading_path.slice(-1)[0] ?? ''}</span>}
        </div>
        <div className={cn('pane-' + src, 'min-h-0 flex-1 overflow-y-auto px-6 py-4')}>
          {!doc || !pv ? <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-4" />)}</div> :
            <BandedText text={doc.text} chunks={pv.chunks} hover={hover} setHover={setHover} focusIdx={focusIdx} nonce={docFocus?.nonce} bands={showBands} />}
        </div>
      </div>
    </div>
  )

  function flash() { setApplied(true); setTimeout(() => setApplied(false), 1500) }
}

function BandedText({ text, chunks, hover, setHover, focusIdx, nonce, bands }: {
  text: string; chunks: PChunk[]; hover: number | null; setHover: (i: number | null) => void; focusIdx: number; nonce?: number; bands: boolean
}) {
  const focusRef = useRef<HTMLSpanElement>(null)
  const segs = useMemo(() => {
    const pts = new Set<number>([0, text.length])
    chunks.forEach((c) => { pts.add(c.start); pts.add(c.end) })
    const sorted = [...pts].sort((x, y) => x - y)
    const out: { s: number; e: number; cover: number[] }[] = []
    let ci = 0
    for (let i = 0; i < sorted.length - 1; i++) {
      const s = sorted[i], e = sorted[i + 1]
      while (ci < chunks.length && chunks[ci].end <= s) ci++
      const cover: number[] = []
      for (let j = Math.max(0, ci - 2); j < chunks.length && chunks[j].start < e; j++) if (chunks[j].start <= s && chunks[j].end >= e) cover.push(j)
      out.push({ s, e, cover })
    }
    return out
  }, [text, chunks])
  const starts = useMemo(() => new Map(chunks.map((c, i) => [c.start, i])), [chunks])

  useEffect(() => {
    if (focusIdx >= 0) focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusIdx, nonce])

  let focusAssigned = false
  return (
    <div className="mx-auto max-w-[860px] whitespace-pre-wrap font-[450] text-[13.5px] leading-[1.75] text-fg/90" onMouseLeave={() => setHover(null)}>
      {segs.map(({ s, e, cover }) => {
        const startIdx = starts.get(s)
        const isFocus = cover.includes(focusIdx)
        const isHover = hover !== null && cover.includes(hover)
        const overlap = cover.length > 1
        let ref: any
        if (isFocus && !focusAssigned) { ref = focusRef; focusAssigned = true }
        const bg = !bands || !cover.length ? undefined :
          isFocus ? 'rgb(var(--pc) / 0.38)' : isHover ? 'rgb(var(--pc) / 0.3)' : overlap ? 'rgb(var(--pc) / 0.26)' : cover[0] % 2 ? 'rgb(var(--pc) / 0.15)' : 'rgb(var(--pc) / 0.07)'
        return (
          <span key={s} ref={ref} onMouseEnter={() => cover.length && setHover(cover[cover.length - 1])}
            title={cover.map((i) => `${chunks[i].id} · ${chunks[i].tokens} tok`).join('  +  ')}
            className={cn('rounded-[3px] transition-colors', overlap && bands && 'band-stripe', isFocus && 'outline outline-2 outline-[rgb(var(--pc))]')}
            style={{ backgroundColor: bg, boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' }}>
            {startIdx !== undefined && bands && (
              <span className="mr-1 select-none rounded bg-[rgb(var(--pc)/0.9)] px-1 align-[1px] font-mono text-[9.5px] font-semibold text-white">{chunks[startIdx].id}</span>
            )}
            {text.slice(s, e)}
          </span>
        )
      })}
    </div>
  )
}

function Histogram({ chunks, max }: { chunks: PChunk[]; max: number }) {
  const [hov, setHov] = useState<number | null>(null)
  const nb = 12
  const top = Math.max(max, ...chunks.map((c) => c.tokens), 1)
  const w = top / nb
  const bins = Array.from({ length: nb }, (_, i) => ({ lo: Math.round(i * w), hi: Math.round((i + 1) * w), n: 0 }))
  chunks.forEach((c) => { bins[Math.min(nb - 1, Math.floor(c.tokens / w))].n++ })
  const mx = Math.max(...bins.map((b) => b.n), 1)
  const H = 70
  const bw = 280 / nb
  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center text-[11px] font-medium text-muted">
        Chunk size distribution
        <span className="num ml-auto text-subtle">{hov !== null ? `${bins[hov].lo}–${bins[hov].hi} tok: ${bins[hov].n} chunk${bins[hov].n === 1 ? '' : 's'}` : 'tokens →'}</span>
      </div>
      <svg viewBox={`0 0 280 ${H + 14}`} className="w-full" onMouseLeave={() => setHov(null)}>
        <line x1="0" x2="280" y1={H} y2={H} stroke="rgb(var(--line))" />
        {bins.map((b, i) => {
          const h = (b.n / mx) * (H - 4)
          return (
            <g key={i} onMouseEnter={() => setHov(i)}>
              <rect x={i * bw} y={0} width={bw} height={H} fill="transparent" />
              {b.n > 0 && <path d={roundedTop(i * bw + 1, H - h, bw - 2, h, Math.min(4, h))} fill="rgb(var(--accent))" opacity={hov === null || hov === i ? 0.9 : 0.4} />}
            </g>
          )
        })}
        <text x="0" y={H + 11} fontSize="8" fill="rgb(var(--subtle))" fontFamily="JetBrains Mono">0</text>
        <text x="280" y={H + 11} fontSize="8" fill="rgb(var(--subtle))" textAnchor="end" fontFamily="JetBrains Mono">{Math.round(top)}</text>
      </svg>
    </div>
  )
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}
