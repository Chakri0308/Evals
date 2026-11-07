import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Lightbulb, Loader2, Play, RefreshCw, Target } from 'lucide-react'
import type { QAnalysis, QInsights, QItem, QTarget, QTerm } from '@/lib/types'
import { TARGET_STYLE } from '@/lib/questionAnalysis'
import { cn } from '@/lib/utils'
import { Button, Tip } from '@/components/ui'

const TERM_STYLE: Record<QTerm['status'], { cls: string; word: string; tip: string }> = {
  gold: { cls: 'border-good/50 bg-good/10 text-good', word: 'in answer', tip: 'Appears word-for-word in the answer passage: BM25 can match it.' },
  gold_section: { cls: 'border-good/30 bg-good/[0.05] text-good', word: 'in answer chunk', tip: "In the answer's chunk or its heading, not in the quoted sentence itself." },
  elsewhere: { cls: 'border-warn/50 bg-warn/10 text-warn', word: 'elsewhere only', tip: 'In the document, but NOT in the answer passage: it pulls keyword search towards other sections (a distractor).' },
  variant: { cls: 'border-accent/50 bg-accent/10 text-accent', word: 'other word form', tip: "Only appears as another form of the word. BM25 doesn't stem, so it misses this; embeddings see the link." },
  absent: { cls: 'border-dashed border-subtle/60 text-subtle', word: 'not in doc', tip: 'Never appears in the document: only semantic search can bridge this paraphrase.' },
}

export function TargetPill({ a, className }: { a?: QAnalysis; className?: string }) {
  if (!a) return <span className="text-[10.5px] text-subtle">…</span>
  const st = TARGET_STYLE[a.target]
  return (
    <Tip content={<div className="max-w-xs"><div className="font-semibold">{a.headline}</div><div className="mt-0.5 text-muted">Tests {a.tests}.</div></div>}>
      <span className={cn('inline-flex cursor-help items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-semibold', st.cls, className)}>
        {st.short}{a.estimated && <span className="font-normal opacity-70">~</span>}
        {a.category_mismatch && <AlertTriangle className="h-2.5 w-2.5 text-warn" />}
      </span>
    </Tip>
  )
}

export function RankMini({ a }: { a?: QAnalysis }) {
  if (!a || a.target === 'abstention') return null
  const r = a.ranks
  const c = (v: number | null) => (v == null ? 'text-subtle' : v <= 2 ? 'text-good' : v <= 5 ? 'text-warn' : 'text-bad')
  return (
    <div className="num mt-0.5 flex gap-1.5 text-[10px]">
      <span className={c(r.bm25)}>B #{r.bm25 ?? '–'}</span>
      <span className={c(r.semantic)}>S #{r.semantic ?? '–'}</span>
      {r.hybrid != null && <span className={c(r.hybrid)}>H #{r.hybrid}</span>}
    </div>
  )
}

/* ------------------------------------------------------------------ suggestions card */
export function SuggestionsPanel({ insights, busy, err, onRerun, onPick, onRun }: {
  insights?: QInsights; busy: boolean; err: string | null; onRerun: () => void; onPick: (id: string) => void; onRun: (q: string) => void
}) {
  const [open, setOpen] = useState(true)
  if (!insights && !busy && !err) return null
  const ctx = insights?.context
  return (
    <div className="mx-3 mt-3 rounded-xl border border-line bg-surface shadow-card">
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5">
          {open ? <ChevronDown className="h-3.5 w-3.5 text-subtle" /> : <ChevronRight className="h-3.5 w-3.5 text-subtle" />}
          <span className="label-box whitespace-nowrap"><Lightbulb className="mr-1 h-3 w-3" />Which question tests what</span>
        </button>
        {insights && (
          <div className="flex flex-wrap gap-1">
            {Object.entries(insights.suggestions.counts).map(([t, n]) => (
              <span key={t} className={cn('rounded-full border px-1.5 text-[10px] font-semibold', TARGET_STYLE[t as QTarget]?.cls)}>{TARGET_STYLE[t as QTarget]?.short} {n}</span>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {ctx && <span className="hidden text-[10.5px] text-subtle xl:inline">measured on {ctx.chunks} chunks · {ctx.chunker}{ctx.semantic_measured ? ` · ${ctx.embedding_model}` : ' · semantic not measured'}</span>}
          <Button size="sm" variant="ghost" onClick={onRerun} disabled={busy}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}Re-analyse
          </Button>
        </div>
      </div>
      {err && <div className="px-3 pb-2 text-[11px] text-bad">{err}</div>}
      {open && insights && (
        <div className="border-t border-line/70 px-3 pb-3 pt-2">
          {!!insights.suggestions.advice.length && (
            <div className="mb-2.5 space-y-1">
              {insights.suggestions.advice.map((a, i) => (
                <div key={i} className="flex items-start gap-1.5 rounded-lg bg-brand/[0.05] px-2 py-1 text-[11.5px] text-fg"><Target className="mt-[2px] h-3 w-3 shrink-0 text-brand" />{a}</div>
              ))}
            </div>
          )}
          {!ctx?.semantic_measured && ctx?.note && (
            <div className="mb-2 text-[11px] text-warn">Semantic ranks weren't measured ({ctx.note.replace(/^semantic rank not measured: /, '')}). Verdicts marked ~ use BM25 ranks and wording only.</div>
          )}
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
            {insights.suggestions.groups.map((g) => (
              <div key={g.id} className="rounded-lg border border-line/80 p-2">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-fg">
                  <span className={cn('h-2 w-2 rounded-full', TARGET_STYLE[g.id as QTarget]?.dot ?? 'bg-subtle')} />{g.title}
                </div>
                <div className="mb-1.5 text-[10.5px] leading-snug text-subtle">{g.hint}</div>
                <ul className="space-y-1">
                  {g.items.map((it) => (
                    <li key={it.id} className="group flex items-start gap-1.5">
                      <button onClick={() => onRun(it.question)} title="Run across all panes" className="mt-[1px] rounded p-0.5 text-brand hover:bg-brand/10"><Play className="h-2.5 w-2.5" /></button>
                      <button onClick={() => onPick(it.id)} className="min-w-0 flex-1 text-left text-[11.5px] leading-snug text-fg hover:text-brand">
                        {it.question}
                        <span className="num ml-1 whitespace-nowrap text-[10px] text-subtle">B#{it.ranks.bm25 ?? '–'} S#{it.ranks.semantic ?? '–'}{it.ranks.hybrid != null ? ` H#${it.ranks.hybrid}` : ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ per-question explanation */
function RankBar({ label, rank, of, tone }: { label: string; rank: number | null; of: number; tone: string }) {
  const pct = rank == null ? 0 : Math.max(6, 100 - ((rank - 1) / Math.max(1, of - 1)) * 100)
  const c = rank == null ? 'bg-line' : rank <= 2 ? 'bg-good' : rank <= 5 ? 'bg-warn' : 'bg-bad'
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className={cn('w-16 shrink-0 font-semibold', tone)}>{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-line/60"><div className={cn('h-full rounded-full', c)} style={{ width: `${pct}%` }} /></div>
      <span className="num w-20 shrink-0 text-right text-muted">{rank == null ? 'not measured' : `#${rank} of ${of}`}</span>
    </div>
  )
}

export function WhyPanel({ q }: { q: QItem }) {
  const a = q.analysis
  if (!a) return <div className="px-3 py-2 text-[11.5px] text-subtle">Analysing…</div>
  return (
    <div className="grid grid-cols-1 gap-3 rounded-xl border border-line bg-surface p-3 lg:grid-cols-[1.25fr_1fr]">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <TargetPill a={a} />
          <span className="text-[13px] font-semibold text-fg">{a.headline}</span>
        </div>
        {a.category_mismatch && (
          <div className="flex items-start gap-1.5 rounded-lg border border-warn/40 bg-warn/[0.07] px-2 py-1.5 text-[11.5px] leading-snug text-fg">
            <AlertTriangle className="mt-[2px] h-3.5 w-3.5 shrink-0 text-warn" />{a.category_mismatch}
          </div>
        )}
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-brand">Why it's a test of {a.tests}</div>
        <ul className="list-disc space-y-1 pl-4 text-[12px] leading-snug text-fg marker:text-subtle">
          {a.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        <div className="rounded-lg bg-elevated/70 px-2 py-1.5 text-[11.5px] leading-snug text-muted"><span className="font-semibold text-fg">If it fails: </span>{a.if_fails}</div>
      </div>
      <div className="min-w-0 space-y-3">
        <div>
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-brand">How the question's words exist in the document</div>
          {a.terms.length ? (
            <div className="flex flex-wrap gap-1">
              {a.terms.map((t) => {
                const st = TERM_STYLE[t.status]
                return (
                  <Tip key={t.term} content={<div className="max-w-xs space-y-0.5">
                    <div className="font-semibold">“{t.term}”: {st.word}</div>
                    <div className="text-muted">{st.tip}</div>
                    <div>{t.occurrences}× in the document, in {t.chunks} chunk{t.chunks === 1 ? '' : 's'} · rarity (IDF) {t.idf}</div>
                    {t.variants && <div>Document uses: {t.variants.join(', ')}</div>}
                    {t.also_in && <div>Also in: {t.also_in.join(', ')}{(t.also_in_count ?? 0) > t.also_in.length ? ` +${(t.also_in_count ?? 0) - t.also_in.length}` : ''}</div>}
                  </div>}>
                    <span className={cn('inline-flex cursor-help items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]', st.cls)}>
                      <span className="font-mono font-semibold">{t.term}</span>
                      <span className="text-[9.5px] opacity-80">{t.status === 'variant' ? `→ ${t.variants?.[0]}` : st.word}</span>
                    </span>
                  </Tip>
                )
              })}
            </div>
          ) : <div className="text-[11px] text-subtle">No content words (only question words).</div>}
          {!!a.gap_terms.length && (
            <div className="mt-1.5">
              <div className="text-[10.5px] text-subtle">The answer passage says, and the question didn't:</div>
              <div className="mt-0.5 flex flex-wrap gap-1">{a.gap_terms.map((t) => <span key={t} className="rounded-md bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-muted">{t}</span>)}</div>
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[9.5px] text-subtle">
            {(Object.keys(TERM_STYLE) as QTerm['status'][]).map((k) => <span key={k} className="flex items-center gap-1"><span className={cn('h-2 w-2 rounded-sm border', TERM_STYLE[k].cls)} />{TERM_STYLE[k].word}</span>)}
          </div>
        </div>
        {a.target !== 'abstention' && (
          <div>
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-brand">Where each retriever ranks the answer</div>
            <div className="space-y-1">
              <RankBar label="BM25" rank={a.ranks.bm25} of={a.ranks.of} tone="text-paneA" />
              <RankBar label="Semantic" rank={a.ranks.semantic} of={a.ranks.of} tone="text-paneB" />
              <RankBar label="Hybrid" rank={a.ranks.hybrid} of={a.ranks.of} tone="text-paneC" />
            </div>
            <div className="mt-1 text-[10.5px] text-subtle">
              Answer chunk{a.gold_chunks.length > 1 ? 's' : ''}: {a.gold_chunks.join(', ') || '–'}{a.gold_sections.length ? ` · ${a.gold_sections.join(' + ')}` : ''}
              {a.top_distractor?.beats_gold && <> · BM25's top hit instead: {a.top_distractor.chunk} ({a.top_distractor.section})</>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
