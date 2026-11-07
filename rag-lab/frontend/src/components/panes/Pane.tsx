import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, Copy, Download, Eye, EyeOff, Layers, Maximize2, Minimize2, MoreHorizontal, Play, ScrollText, Upload, Workflow } from 'lucide-react'
import type { PaneId, PipelineConfig } from '@/lib/types'
import { PANE_IDS } from '@/lib/types'
import { cn, deepClone, hashConfig, queryTerms } from '@/lib/utils'
import { computeDiff } from '@/lib/diff'
import { useApp, visiblePanes } from '@/store/app'
import { api, post } from '@/api/client'
import { Badge, Button, Empty, Popover, PopoverContent, PopoverTrigger, Skeleton, Tabs, Tip } from '@/components/ui'
import { FlowStrip } from './FlowStrip'
import { ConfigDrawer } from './ConfigDrawer'
import { AnswerCard } from './AnswerCard'
import { ChunkCard } from './ChunkCard'
import { PromptView, TraceView } from './TraceView'
import { ReadinessCard } from './ReadinessCard'

export function Pane({ pane }: { pane: PaneId }) {
  const cfg = useApp((s) => s.panes[pane])
  const panes = useApp((s) => s.panes)
  const reg = useApp((s) => s.registry)
  const vis = useApp(visiblePanes)
  const run = useApp((s) => s.runs[pane])
  const question = useApp((s) => s.question)
  const drawer = useApp((s) => s.openDrawer[pane])
  const tab = useApp((s) => s.paneTab[pane])
  const maximized = useApp((s) => s.maximized)
  const a = useApp.getState()

  const diff = useMemo(() => computeDiff(reg, panes, vis, pane), [reg, panes, vis, pane])
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => { if (drawer) scroller.current?.scrollTo({ top: 0, behavior: 'smooth' }) }, [drawer])
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }) }, [tab])
  const outdated = run.status !== 'idle' && run.status !== 'running' && (run.configHash !== hashConfig(cfg) || run.question !== question)
  const running = run.status === 'running'

  return (
    <div className={cn('pane-' + pane, 'flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-line/60 bg-surface shadow-card')}>
      <div className="relative shrink-0">
        <div className="absolute inset-x-0 top-0 h-[4px] bg-pc" />
        <div className="flex items-center gap-2 px-3 pb-2 pt-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-pc text-[11px] font-bold text-white">{pane}</span>
          <PaneName pane={pane} name={cfg.name} />
          {!!diff._count && <Tip content={`${diff._count} setting(s) differ from the other panes`}><Badge tone="warn" className="cursor-help">≠ {diff._count}</Badge></Tip>}
          <AnimatePresence>
            {outdated && (
              <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                <Tip content="The config or question changed since the last run"><Badge tone="warn" className="cursor-help">outdated</Badge></Tip>
              </motion.span>
            )}
          </AnimatePresence>
          <div className="ml-auto flex items-center gap-0.5">
            <Tip content="Re-run this pane"><Button size="icon" variant="ghost" disabled={!question.trim()} onClick={() => a.runPanes([pane])}>
              <Play className={cn('h-3.5 w-3.5', running && 'animate-pulse text-pc')} /></Button></Tip>
            <PaneMenu pane={pane} cfg={cfg} />
            <Tip content={maximized === pane ? 'Restore' : 'Maximize'}>
              <Button size="icon" variant="ghost" onClick={() => a.setMaximized(maximized === pane ? null : pane)}>
                {maximized === pane ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </Button>
            </Tip>
          </div>
        </div>
        <FlowStrip pane={pane} diff={diff} />
      </div>
      {/* one scroll area for drawer + tabs + output: with a stage drawer open you can still scroll down to the
          results, and the tabs stick to the top. Picking a tab closes the drawer. */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
      <AnimatePresence initial={false}>{drawer && <ConfigDrawer key={drawer} pane={pane} stage={drawer} diff={diff} />}</AnimatePresence>
      <Tabs className="sticky top-0 z-10 bg-surface px-2" value={tab} onChange={(t) => { a.setPaneTab(pane, t); a.setOpenDrawer(pane, null) }}
        tabs={[
          { value: 'results', label: 'Results', icon: <Layers className="h-3 w-3" /> },
          { value: 'trace', label: 'Trace', icon: <Workflow className="h-3 w-3" /> },
          { value: 'prompt', label: 'Prompt', icon: <ScrollText className="h-3 w-3" /> },
        ]}
        right={tab === 'results' ? <DroppedToggle /> : null}
      />
      <div className="px-3 py-3">
        {tab === 'results' && <Results pane={pane} />}
        {tab === 'trace' && <TraceView pane={pane} />}
        {tab === 'prompt' && <PromptView pane={pane} />}
      </div>
      </div>
    </div>
  )
}

function DroppedToggle() {
  const show = useApp((s) => s.showDropped)
  const set = useApp((s) => s.setShowDropped)
  return (
    <Tip content="Show chunks that were retrieved but dropped (by top_k, rerank, threshold or token budget)">
      <button onClick={() => set(!show)} className={cn('flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]', show ? 'text-fg' : 'text-subtle hover:text-fg')}>
        {show ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}dropped
      </button>
    </Tip>
  )
}

function Results({ pane }: { pane: PaneId }) {
  const run = useApp((s) => s.runs[pane])
  const showDropped = useApp((s) => s.showDropped)
  const res = run.result
  const terms = useMemo(() => queryTerms(run.question ?? ''), [run.question])
  if (run.status === 'idle') {
    return (
      <Empty icon={<Play className="h-4 w-4" />} title="Ready when you are">
        Type a question above and press <span className="font-mono">Ctrl/⌘ + Enter</span>. This pane streams its answer and shows the exact chunks that produced it.
      </Empty>
    )
  }
  const cited = new Set(res?.cited ?? [])
  const notReady = res?.not_ready ?? run.stages.retrieval?.trace?.readiness
  if (notReady) return <ReadinessCard report={notReady} />
  return (
    <div className="space-y-3">
      <AnswerCard pane={pane} />
      {!res && run.status === 'running' && (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}</div>
      )}
      {res && (
        <>
          <div className="flex items-center gap-2 px-0.5 text-[11px] text-subtle">
            <span className="font-semibold uppercase tracking-wider">Context</span>
            <span className="num">{res.hits.length} chunk{res.hits.length === 1 ? '' : 's'}</span>
            {res.num_chunks !== undefined && <span className="num">of {res.num_chunks}</span>}
            {!!cited.size && <span className="num text-pc">· {cited.size} cited</span>}
          </div>
          {res.hits.length === 0 && (
            <div className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-muted">
              {res.status?.retrieval === 'skipped' ? 'Retrieval is off: closed-book baseline, no context.' : 'No chunks matched.'}
            </div>
          )}
          {res.hits.map((h, i) => (
            <ChunkCard key={h.chunk_id} pane={pane} hit={h} chunk={res.chunks[h.chunk_id]} rank={i + 1} terms={terms} cited={cited.has(h.chunk_id)} />
          ))}
          {showDropped && res.dropped.length > 0 && (
            <>
              <div className="px-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">Retrieved but dropped · {res.dropped.length}</div>
              {res.dropped.map((h, i) => (
                <ChunkCard key={'d' + h.chunk_id} pane={pane} hit={h} chunk={res.chunks[h.chunk_id]} rank={i + 1} terms={terms} cited={false} dropped />
              ))}
            </>
          )}
        </>
      )}
    </div>
  )
}

function PaneName({ pane, name }: { pane: PaneId; name: string }) {
  const [edit, setEdit] = useState(false)
  const [v, setV] = useState(name)
  const setName = useApp((s) => s.setPaneName)
  if (edit)
    return (
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { setName(pane, v || name); setEdit(false) }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="h-6 w-36 rounded border border-line bg-elevated px-1.5 text-[13px] font-semibold focus:outline-none" />
    )
  return <button onDoubleClick={() => { setV(name); setEdit(true) }} title="Double-click to rename" className="truncate text-[13px] font-semibold">{name}</button>
}

function PaneMenu({ pane, cfg }: { pane: PaneId; cfg: PipelineConfig }) {
  const a = useApp.getState()
  const qc = useQueryClient()
  const { data: presets } = useQuery({ queryKey: ['presets'], queryFn: () => api<any[]>('/api/presets') })
  const [open, setOpen] = useState(false)
  const item = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent/10'
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' })
    const u = URL.createObjectURL(blob)
    const el = document.createElement('a')
    el.href = u
    el.download = `pipeline-${cfg.name.replace(/\W+/g, '_')}.json`
    el.click()
    URL.revokeObjectURL(u)
  }
  const importJson = () => {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = '.json'
    inp.onchange = async () => {
      const f = inp.files?.[0]
      if (!f) return
      try { a.replacePane(pane, JSON.parse(await f.text())) } catch { alert('Invalid pipeline JSON') }
    }
    inp.click()
  }
  const save = async () => {
    const name = prompt('Preset name', cfg.name)
    if (!name) return
    await post('/api/presets', { name, pipeline: { ...deepClone(cfg), name } })
    qc.invalidateQueries({ queryKey: ['presets'] })
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button size="icon" variant="ghost" aria-label="Pane menu"><MoreHorizontal className="h-3.5 w-3.5" /></Button></PopoverTrigger>
      <PopoverContent className="w-60">
        <div className="px-2 pb-1 pt-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-subtle">Duplicate into</div>
        <div className="flex gap-1 px-2 pb-2">
          {PANE_IDS.filter((p) => p !== pane).map((p) => (
            <Button key={p} size="sm" className={`pane-${p}`} onClick={() => { a.duplicatePane(pane, p); setOpen(false) }}>
              <Copy className="h-3 w-3 text-pc" />Pane {p}
            </Button>
          ))}
        </div>
        <div className="my-1 h-px bg-line" />
        <div className="px-2 pb-1 pt-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-subtle">Load preset</div>
        <div className="max-h-48 overflow-y-auto">
          {(presets ?? []).map((p) => (
            <button key={p.name} className={item} onClick={() => { a.replacePane(pane, p.pipeline); setOpen(false) }}>
              <Bookmark className="h-3 w-3 text-subtle" /><span className="truncate">{p.name}</span>
              {p.builtin && <span className="ml-auto text-[10px] text-subtle">built-in</span>}
            </button>
          ))}
        </div>
        <div className="my-1 h-px bg-line" />
        <button className={item} onClick={save}><Bookmark className="h-3 w-3" />Save as preset…</button>
        <button className={item} onClick={exportJson}><Download className="h-3 w-3" />Export JSON</button>
        <button className={item} onClick={importJson}><Upload className="h-3 w-3" />Import JSON</button>
      </PopoverContent>
    </Popover>
  )
}
