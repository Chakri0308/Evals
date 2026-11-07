import { useState } from 'react'
import { ChevronRight, Copy } from 'lucide-react'
import type { PaneId, StageName } from '@/lib/types'
import { STAGES, STAGE_LABEL } from '@/lib/types'
import { cn, fmtMs } from '@/lib/utils'
import { useApp } from '@/store/app'
import { Badge, Button, Empty } from '@/components/ui'
import { JsonBlock } from '@/components/common/JsonView'

function readable(stage: StageName, t: any): string[] {
  if (!t) return []
  const out: string[] = []
  if (t.skipped) out.push(`Skipped: ${t.skipped}`)
  switch (stage) {
    case 'query_transform': {
      const b = t.bundle
      if (b) {
        out.push(`Lexical queries: ${b.queries.map((q: string) => `“${q}”`).join(' · ')}`)
        if (JSON.stringify(b.queries) !== JSON.stringify(b.dense_queries)) out.push(`Dense queries: ${b.dense_queries.map((q: string) => `“${q.slice(0, 160)}”`).join(' · ')}`)
      }
      break
    }
    case 'chunking':
      out.push(`${t.chunks} chunks · avg ${t.avg_tokens} tok · max ${t.max_tokens} tok · cache ${t.cache_hit ? 'hit' : 'miss'} (${t.chunkset_key})`)
      break
    case 'retrieval':
      for (const [k, v] of Object.entries<any[]>(t.lists ?? {})) out.push(`${k}: ${v.length} candidates → ${v.slice(0, 8).map((h) => h.chunk_id).join(', ')}${v.length > 8 ? '…' : ''}`)
      if (t.index_cache) out.push(`Index cache: ${Object.entries(t.index_cache).map(([k, v]) => `${k} ${v ? 'hit' : 'built'}`).join(', ')}`)
      if (t.vector_store) {
        const vs = t.vector_store
        out.push(vs.vector_store === 'chroma'
          ? `Vector DB: Chroma collection ${vs.collection} · ${vs.vectors} vectors · ${vs.cached ? 'reused' : 'built now'}`
          : `Vector search: in-memory NumPy · ${vs.vectors} vectors`)
      }
      break
    case 'fusion':
      if (t.fused) out.push(`Fused order: ${t.fused.slice(0, 10).map((h: any) => h.chunk_id).join(', ')}`)
      if (t.note) out.push(t.note)
      break
    case 'rerank':
      if (t.ranked) out.push(`Reranked: ${t.ranked.map((h: any) => `${h.chunk_id}${h.ranks?.retrieval ? `(#${h.ranks.retrieval}→#${h.ranks.rerank})` : ''}`).join(', ')}`)
      break
    case 'context_filter':
      if (t.kept) out.push(`Kept: ${t.kept.join(', ') || 'none'} · ${t.context_tokens ?? '?'} context tokens`)
      for (const d of t.dropped ?? []) out.push(`Dropped ${d.id}: ${d.reason}`)
      break
    case 'prompt':
      if (t.tokens) out.push(`${t.tokens} prompt tokens${t.closed_book ? ' · closed-book' : ''}`)
      break
    case 'generation':
      if (t.model) out.push(`${t.provider} · ${t.model} · in ${t.usage?.input_tokens} / out ${t.usage?.output_tokens} tok`)
      break
  }
  return out
}

export function TraceView({ pane }: { pane: PaneId }) {
  const run = useApp((s) => s.runs[pane])
  if (run.status === 'idle') return <Empty title="No trace yet">Run a question to see every stage's input and output.</Empty>
  return (
    <div className="space-y-1.5">
      {STAGES.map((s) => <TraceRow key={s} stage={s} st={run.stages[s]} />)}
    </div>
  )
}

function TraceRow({ stage, st }: { stage: StageName; st?: any }) {
  const [open, setOpen] = useState(stage === 'query_transform' || stage === 'context_filter')
  const lines = readable(stage, st?.trace ?? (st?.reason ? { skipped: st.reason } : undefined))
  const tone = st?.status === 'error' ? 'bad' : st?.status === 'ok' ? 'good' : 'neutral'
  return (
    <div className="rounded-lg border border-line bg-surface">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
        <ChevronRight className={cn('h-3 w-3 text-subtle transition-transform', open && 'rotate-90')} />
        <span className="text-xs font-semibold">{STAGE_LABEL[stage]}</span>
        <span className="text-[11px] text-subtle">{st?.component}</span>
        <Badge tone={tone as any} className="ml-auto">{st?.status ?? 'pending'}</Badge>
        <span className="num w-12 text-right text-[11px] text-subtle">{fmtMs(st?.ms)}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-line/60 px-3 py-2">
          {st?.error && <div className="font-mono text-[11.5px] text-bad">{st.error}</div>}
          {lines.map((l, i) => <div key={i} className="break-words text-[12px] leading-relaxed text-fg/85">{l}</div>)}
          {st?.trace && <JsonBlock data={st.trace} className="max-h-72 overflow-auto rounded-md bg-bg/60 p-2" />}
        </div>
      )}
    </div>
  )
}

export function PromptView({ pane }: { pane: PaneId }) {
  const res = useApp((s) => s.runs[pane].result)
  const qb = res?.query_bundle
  if (!res?.prompt) return <Empty title="No prompt yet">The exact prompt sent to the LLM appears here after a run.</Empty>
  const copy = () => navigator.clipboard.writeText(`SYSTEM:\n${res.prompt!.system}\n\nUSER:\n${res.prompt!.user}`)
  return (
    <div className="space-y-2">
      {qb && qb.notes && Object.keys(qb.notes).length > 0 && (
        <div className="rounded-lg border border-line bg-surface p-2.5">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-subtle">Query transform</div>
          {Object.entries(qb.notes).map(([k, v]) => (
            <div key={k} className="text-[12px] leading-relaxed"><span className="text-muted">{k.replace(/_/g, ' ')}: </span>
              {Array.isArray(v) ? <ol className="ml-4 list-decimal">{v.map((x, i) => <li key={i}>{x}</li>)}</ol> : <span>{String(v)}</span>}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Badge>{res.prompt.tokens} tokens</Badge>
        {res.prompt.closed_book && <Badge tone="warn">closed-book</Badge>}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={copy}><Copy className="h-3 w-3" />Copy</Button>
      </div>
      <PromptBlock title="System" text={res.prompt.system} />
      <PromptBlock title="User" text={res.prompt.user} />
    </div>
  )
}

function PromptBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="border-b border-line/60 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-subtle">{title}</div>
      <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words p-2.5 font-mono text-[11.5px] leading-relaxed text-fg/85">{text || '(empty)'}</pre>
    </div>
  )
}
