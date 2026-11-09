import { Fragment, useState, type ReactNode } from 'react'
import { AlertTriangle, BookX, KeyRound, MessageSquare, Quote, ServerOff, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react'
import type { PaneId, StageName } from '@/lib/types'
import { STAGES, STAGE_LABEL } from '@/lib/types'
import { cn, fmtMs } from '@/lib/utils'
import { useApp } from '@/store/app'
import { usePaneAnnotation } from '@/lib/annotations'
import { Skeleton, Tip } from '@/components/ui'

function renderAnswer(text: string, onCite: (id: string) => void, known: Set<string>): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\[([^\]]*?C\d+[^\]]*?)\]/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<Fragment key={`t${i}`}>{inlineMd(text.slice(last, m.index))}</Fragment>)
    const ids = m[1].match(/C\d+/g) ?? []
    out.push(
      <span key={`c${i}`} className="whitespace-nowrap">
        {ids.map((id) => (
          <button key={id} onClick={() => onCite(id)}
            className={cn('mx-px rounded px-1 py-px align-baseline font-mono text-[10.5px] font-semibold transition-colors',
              known.has(id) ? 'bg-pc-soft text-pc ring-1 ring-inset ring-[rgb(var(--pc)/0.35)] hover:bg-[rgb(var(--pc)/0.2)]' : 'bg-bad/10 text-bad line-through')}
            title={known.has(id) ? `Jump to ${id}` : `${id} was not in the context (hallucinated citation)`}>
            {id}
          </button>
        ))}
      </span>,
    )
    last = m.index + m[0].length
    i++
  }
  if (last < text.length) out.push(<Fragment key="end">{inlineMd(text.slice(last))}</Fragment>)
  return out
}

function inlineMd(t: string): ReactNode[] {
  return t.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p))
}

export function AnswerCard({ pane }: { pane: PaneId }) {
  const run = useApp((s) => s.runs[pane])
  const cfg = useApp((s) => s.panes[pane])
  const focusChunk = useApp((s) => s.focusChunk)
  const res = run.result
  const known = new Set((res?.hits ?? []).map((h) => h.chunk_id))
  const genOff = !cfg.stages.generation.enabled
  const closedBook = !cfg.stages.retrieval.enabled
  const streaming = run.status === 'running' && run.stages.generation?.status === 'running'

  if (run.error) return <ErrorCard stage={run.error.stage} message={run.error.message} />
  if (run.status === 'idle') return null
  if (res?.not_ready || run.stages.retrieval?.status === 'not_ready') return null
  const fb = res?.answer_source?.kind === 'extractive_fallback' ? res.answer_source : null
  const genTrace = run.stages.generation?.trace?.fallback
  if (genOff && run.status === 'done') {
    return <div className="rounded-xl border border-dashed border-line px-3 py-2.5 text-xs text-muted">Generation is off: a retrieval-only run. Inspect the chunks below.</div>
  }
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-1.5 border-b border-line/70 px-3 py-1.5 text-[11px] font-medium text-subtle">
        <Sparkles className="h-3 w-3 text-pc" /> Answer
        {closedBook && <span className="ml-1 inline-flex items-center gap-1 rounded bg-warn/10 px-1.5 text-warn"><BookX className="h-3 w-3" />closed-book</span>}
        {(fb || genTrace) && (
          <Tip content={<div className="max-w-xs space-y-1"><div>{(fb ?? genTrace).wanted} could not be used: {(fb ?? genTrace).reason}</div><div className="text-muted">So the answer quotes the best-matching sentences from the retrieved chunks, with citations. No model was called.</div></div>}>
            <span className="ml-1 inline-flex cursor-help items-center gap-1 rounded bg-accent/10 px-1.5 text-accent"><Quote className="h-3 w-3" />no-LLM answer</span>
          </Tip>
        )}
        {streaming && <span className="ml-auto flex items-center gap-1 text-pc"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pc" />streaming</span>}
      </div>
      <div className="px-3 py-2.5 text-[13.5px] leading-relaxed text-fg">
        {run.answer ? (
          <div className="whitespace-pre-wrap">
            {renderAnswer(run.answer, (id) => focusChunk(pane, id), known.size ? known : new Set(Object.keys(res?.chunks ?? {})))}
            {streaming && <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-pc align-middle" />}
          </div>
        ) : run.status === 'running' ? (
          <div className="space-y-2 py-1"><Skeleton className="h-3 w-[92%]" /><Skeleton className="h-3 w-[80%]" /><Skeleton className="h-3 w-[55%]" /></div>
        ) : <span className="text-subtle">No answer.</span>}
      </div>
      {!!res?.notices?.length && (
        <div className="space-y-0.5 border-t border-line/70 bg-accent/[0.04] px-3 py-1.5">
          {res.notices.map((n, i) => (
            <div key={i} className="text-[11px] leading-snug text-muted"><span className="font-semibold text-accent">{n.stage.replace('_', ' ')}</span> · {n.message}</div>
          ))}
        </div>
      )}
      {res && run.status === 'done' && <ReviewBar pane={pane} />}
      {res && <AnswerFooter pane={pane} />}
    </div>
  )
}

/** Human review: thumbs up/down and a note. Saved per question + pipeline config, listed in the Annotations tab. */
function ReviewBar({ pane }: { pane: PaneId }) {
  const { current, save, canAnnotate } = usePaneAnnotation(pane)
  const verdict = current?.verdict ?? null
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  if (!canAnnotate) return null
  const labelled = Object.keys(current?.chunk_labels ?? {}).length
  const btn = (on: boolean, tone: 'good' | 'bad') => cn('flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition-colors',
    on ? (tone === 'good' ? 'border-good/50 bg-good/10 text-good' : 'border-bad/50 bg-bad/10 text-bad') : 'border-line text-muted hover:border-subtle/70 hover:text-fg')
  return (
    <div className="border-t border-line/70 px-3 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="mr-1 text-[11px] text-subtle">Your review</span>
        <Tip content="Good answer"><button aria-pressed={verdict === 'up'} className={btn(verdict === 'up', 'good')} onClick={() => save({ verdict: verdict === 'up' ? null : 'up' })}><ThumbsUp className="h-3 w-3" /></button></Tip>
        <Tip content="Bad answer"><button aria-pressed={verdict === 'down'} className={btn(verdict === 'down', 'bad')} onClick={() => save({ verdict: verdict === 'down' ? null : 'down' })}><ThumbsDown className="h-3 w-3" /></button></Tip>
        <button onClick={() => { if (!noteOpen) setNote(current?.note ?? ''); setNoteOpen(!noteOpen) }}
          className={cn('flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition-colors',
            noteOpen || current?.note ? 'border-subtle/60 bg-elevated text-fg' : 'border-line text-muted hover:border-subtle/70 hover:text-fg')}>
          <MessageSquare className="h-3 w-3" />{current?.note ? 'Note' : 'Add note'}
        </button>
        <span className="ml-auto text-[10.5px] text-subtle">
          {labelled ? `${labelled} chunk${labelled > 1 ? 's' : ''} labelled · ` : ''}mark chunks relevant below
        </span>
      </div>
      {noteOpen && (
        <textarea value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (current?.note ?? '') && save({ note })}
          rows={2} placeholder="What's wrong or right about this answer? (saved when you click away)"
          className="mt-1.5 w-full resize-y rounded-md border border-line bg-bg px-2 py-1 text-[12px] text-fg placeholder:text-subtle focus:border-accent/70 focus:outline-none" />
      )}
    </div>
  )
}

function AnswerFooter({ pane }: { pane: PaneId }) {
  const res = useApp((s) => s.runs[pane].result)!
  const total = res.total_ms || 1
  const parts = STAGES.filter((s) => res.timings?.[s] !== undefined && res.timings[s] > 0)
  return (
    <div className="space-y-1.5 border-t border-line/70 bg-bg/40 px-3 py-2">
      <div className="flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full">
        {parts.map((s, i) => (
          <Tip key={s} content={`${STAGE_LABEL[s as StageName]} · ${fmtMs(res.timings[s])}`}>
            <div className="h-full rounded-sm" style={{ width: `${Math.max(2, (res.timings[s] / total) * 100)}%`, background: `rgb(var(--pc) / ${0.35 + 0.65 * ((i + 1) / parts.length)})` }} />
          </Tip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10.5px] tabular-nums text-subtle">
        <span>total <span className="text-fg">{fmtMs(res.total_ms)}</span></span>
        {parts.map((s) => <span key={s}>{STAGE_LABEL[s as StageName].toLowerCase()} {fmtMs(res.timings[s])}</span>)}
        <span className="ml-auto">in <span className="text-fg">{res.usage?.input_tokens ?? 0}</span> · out <span className="text-fg">{res.usage?.output_tokens ?? 0}</span> tok</span>
        <span>${(res.usage?.cost_usd ?? 0).toFixed(4)}</span>
      </div>
    </div>
  )
}

export function ErrorCard({ stage, message }: { stage: string; message: string }) {
  const key = /API_KEY/.test(message)
  const ollama = /Ollama|ollama/.test(message)
  const Icon = key ? KeyRound : ollama ? ServerOff : AlertTriangle
  return (
    <div className="rounded-xl border border-bad/30 bg-bad/[0.06] p-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-bad">
        <Icon className="h-4 w-4" />
        {key ? 'Missing API key' : ollama ? 'Local model unavailable' : 'Stage failed'}
        <span className="rounded bg-bad/10 px-1.5 font-mono text-[10.5px] font-medium">{stage}</span>
      </div>
      <div className="mt-1.5 break-words font-mono text-[11.5px] leading-relaxed text-fg/80">{message}</div>
      {(key || ollama) && (
        <div className="mt-2 text-[11.5px] text-muted">
          {key ? 'Add the key to rag-lab/.env and restart the backend, or switch the Generate stage to Ollama.' :
            'Install Ollama from ollama.com, run `ollama serve`, then `ollama pull qwen2.5:1.5b`. Or switch Generate to “Extractive (no LLM)”.'}
        </div>
      )}
    </div>
  )
}
