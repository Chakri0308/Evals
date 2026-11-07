import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowDown, ArrowUp, CheckCircle2, ChevronDown, FileSearch, Minus, Quote } from 'lucide-react'
import type { Chunk, Hit, PaneId } from '@/lib/types'
import { cn, fmtScore, locationLabel } from '@/lib/utils'
import { Prose } from '@/lib/highlight'
import { useApp } from '@/store/app'
import { Badge, Tip } from '@/components/ui'

const SCORE_META: Record<string, { label: string; tip: string }> = {
  bm25: { label: 'BM25', tip: 'BM25 keyword score (unbounded)' },
  dense: { label: 'cos', tip: 'Dense cosine similarity (−1…1)' },
  fused: { label: 'fused', tip: 'Fusion score (RRF or weighted)' },
  rerank: { label: 'rerank', tip: 'Reranker score' },
}

export function ChunkCard({ pane, hit, chunk, rank, terms, cited, dropped }: {
  pane: PaneId; hit: Hit; chunk?: Chunk; rank: number; terms: string[]; cited: boolean; dropped?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const focus = useApp((s) => s.focus)
  const showInDoc = useApp((s) => s.showInDoc)
  const [flash, setFlash] = useState(0)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (focus && focus.pane === pane && focus.chunkId === hit.chunk_id) {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setFlash(focus.nonce)
      setExpanded(true)
    }
  }, [focus, pane, hit.chunk_id])

  const before = hit.ranks.retrieval
  const after = hit.ranks.rerank
  const moved = before !== undefined && after !== undefined && before !== after
  const long = (chunk?.text.length ?? 0) > 700

  return (
    <motion.div
      ref={ref}
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: dropped ? 0.5 : 1, y: 0 }}
      transition={{ duration: 0.2, delay: Math.min(rank, 8) * 0.025 }}
      className={cn('group rounded-xl border bg-surface transition-colors', cited ? 'border-pc' : 'border-line', dropped && 'border-dashed')}
    >
      <div key={flash} className={cn('rounded-xl', flash ? 'animate-flash' : '')}>
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
          <span className={cn('num flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-[11px] font-semibold', dropped ? 'bg-elevated text-subtle' : 'bg-pc-soft text-pc')}>
            {dropped ? '–' : `#${rank}`}
          </span>
          <span className="num text-[11.5px] font-semibold text-fg">{hit.chunk_id}</span>
          {moved && (
            <Tip content={`Rank before rerank #${before} → after #${after}`}>
              <span className={cn('num inline-flex items-center gap-0.5 rounded px-1 text-[10.5px]', after! < before! ? 'bg-good/10 text-good' : 'bg-bad/10 text-bad')}>
                {after! < before! ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}#{before}→#{after}
              </span>
            </Tip>
          )}
          {before !== undefined && after !== undefined && !moved && <span className="num inline-flex items-center text-[10.5px] text-subtle"><Minus className="h-2.5 w-2.5" /></span>}
          {cited && <Badge tone="pane"><Quote className="h-2.5 w-2.5" />cited</Badge>}
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted" title={chunk ? locationLabel(chunk) : ''}>{chunk ? locationLabel(chunk) : ''}</span>
          <span className="num text-[10.5px] text-subtle">{chunk?.tokens ?? '?'} tok</span>
        </div>
        <div className="flex flex-wrap gap-1 px-3 pt-1.5">
          {Object.entries(SCORE_META).map(([k, m]) => hit.scores[k] !== undefined && (
            <Tip key={k} content={`${m.tip}${hit.ranks[k] ? ` · rank #${hit.ranks[k]} in this list` : ''}`}>
              <span className="num inline-flex items-center gap-1 rounded-md border border-line bg-bg/50 px-1.5 py-px text-[10.5px]">
                <span className="text-subtle">{m.label}</span><span className="text-fg">{fmtScore(hit.scores[k])}</span>
                {hit.ranks[k] && <span className="text-subtle">#{hit.ranks[k]}</span>}
              </span>
            </Tip>
          ))}
          {hit.drop_reason && (
            <span className={cn('rounded-md px-1.5 py-px text-[10.5px]', dropped ? 'bg-bad/10 text-bad' : 'bg-elevated text-muted')}>
              {dropped ? `dropped by ${hit.dropped_by}: ` : ''}{hit.drop_reason}
            </span>
          )}
        </div>
        <div className={cn('relative px-3 pb-2 pt-2', !expanded && long && 'max-h-[180px] overflow-hidden')}>
          {chunk ? <Prose text={chunk.text} terms={terms} /> : <span className="text-xs text-subtle">chunk text unavailable</span>}
          {!expanded && long && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-surface to-transparent" />}
        </div>
        <div className="flex items-center gap-1 border-t border-line/60 px-2 py-1">
          {long && (
            <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-elevated hover:text-fg">
              <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />{expanded ? 'Collapse' : 'Expand'}
            </button>
          )}
          {cited && <span className="flex items-center gap-1 text-[11px] text-pc"><CheckCircle2 className="h-3 w-3" />used in answer</span>}
          <button onClick={() => showInDoc(pane, hit.chunk_id)} className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-elevated hover:text-fg">
            <FileSearch className="h-3 w-3" />Show in document
          </button>
        </div>
      </div>
    </motion.div>
  )
}
