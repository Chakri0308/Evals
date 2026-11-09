import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Download, ListPlus, Loader2, MessageSquare, Play, Scale, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react'
import { del, sse } from '@/api/client'
import { LlmPicker, type LlmChoice } from '@/components/common/LlmPicker'
import { useApp } from '@/store/app'
import { download, useQSet } from '@/store/qset'
import { useAnnotations, type Annotation } from '@/lib/annotations'
import type { QItem } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Badge, Button, Empty, Segmented, Tip } from '@/components/ui'

type Filter = 'all' | 'up' | 'down' | 'labelled'

const relevantOf = (a: Annotation) => Object.entries(a.chunk_labels ?? {}).filter(([, v]) => v === 'relevant').map(([k]) => k)

/** A gold question built from a human annotation: the chunks marked relevant become the gold spans. */
function toQItem(a: Annotation): QItem | null {
  const rel = new Set(relevantOf(a))
  const chunks = a.chunks.filter((c) => rel.has(c.id))
  if (!chunks.length) return null
  return {
    id: `h-${a.id}`,
    category: 'human_labeled',
    question: a.question,
    // a thumbs-up answer is a reasonable reference answer; strip the [C3] citations
    expected_answer: a.verdict === 'up' ? a.answer.replace(/\s*\[[^\]]*C\d+[^\]]*\]/g, '').trim() : '',
    gold_spans: chunks.map((c) => ({ start: c.start, end: c.end, page: c.page ?? null, heading_path: c.heading_path, quote: c.text.slice(0, 240), match: 'human' })),
    difficulty: 'medium',
    what_it_stresses: 'Human-labelled relevance',
    notes: a.note,
    source: 'annotation',
    valid: true,
  }
}

export function AnnotationsTab() {
  const docId = useApp((s) => s.docId)
  const { data, isLoading } = useAnnotations(docId)
  const qc = useQueryClient()
  const qset = useQSet((s) => (docId ? s.byDoc[docId] : undefined)) ?? []
  const addQ = useQSet((s) => s.add)
  const [filter, setFilter] = useState<Filter>('all')
  const [msg, setMsg] = useState<string | null>(null)

  const all = useMemo(() => data ?? [], [data])
  const shown = all.filter((a) => filter === 'all' || (filter === 'labelled' ? relevantOf(a).length > 0 : a.verdict === filter))
  const counts = useMemo(() => ({
    up: all.filter((a) => a.verdict === 'up').length,
    down: all.filter((a) => a.verdict === 'down').length,
    labelled: all.filter((a) => relevantOf(a).length).length,
  }), [all])

  const remove = async (id: string) => {
    await del(`/api/annotations/${encodeURIComponent(id)}`)
    qc.invalidateQueries({ queryKey: ['annotations', docId] })
  }
  const rerun = (q: string) => {
    const a = useApp.getState()
    a.setQuestion(q)
    setTimeout(() => a.runPanes(), 0)
  }
  const addToSet = () => {
    if (!docId) return
    const have = new Set(qset.map((q) => q.id))
    const items = all.map(toQItem).filter((q): q is QItem => !!q && !have.has(q.id))
    if (items.length) addQ(docId, items)
    const skipped = counts.labelled - items.length
    setMsg(items.length
      ? `Added ${items.length} question${items.length > 1 ? 's' : ''} to the question set${skipped ? ` (${skipped} already there)` : ''}. Run them in Batch Eval.`
      : counts.labelled ? 'All labelled questions are already in the question set.' : 'Mark at least one chunk as relevant first.')
  }

  if (!docId) return <Empty title="No document" />
  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <Segmented size="xs" value={filter} onChange={setFilter} options={[
            { value: 'all', label: `All ${all.length}` },
            { value: 'up', label: <span className="inline-flex items-center gap-1"><ThumbsUp className="h-2.5 w-2.5" />{counts.up}</span>, title: 'Good answers' },
            { value: 'down', label: <span className="inline-flex items-center gap-1"><ThumbsDown className="h-2.5 w-2.5" />{counts.down}</span>, title: 'Bad answers' },
            { value: 'labelled', label: `With relevant chunks ${counts.labelled}` },
          ]} />
          <div className="ml-auto flex items-center gap-1">
            <Tip content="Turn every annotation with chunks marked relevant into a gold question (relevant chunks = gold evidence)">
              <Button size="sm" variant="secondary" onClick={addToSet} disabled={!counts.labelled}><ListPlus className="h-3 w-3" />Add to question set</Button>
            </Tip>
            <Button size="sm" variant="ghost" disabled={!all.length} onClick={() => download(`annotations-${docId}.json`, JSON.stringify(all, null, 2))}><Download className="h-3 w-3" />JSON</Button>
          </div>
        </div>
        {msg && <div className="shrink-0 border-b border-line bg-elevated px-3 py-1.5 text-[11.5px] text-muted">{msg}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…</div>
          ) : !all.length ? (
            <Empty icon={<MessageSquare className="h-4 w-4" />} title="No annotations yet">
              After a run, use <b>👍 / 👎</b> and <b>Add note</b> under an answer, and <b>Relevant / Not relevant</b> on its chunks. Labels are saved per question and pipeline config and collected here.
            </Empty>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 z-10 bg-surface text-left text-[10.5px] uppercase tracking-wider text-subtle">
                <tr><th className="w-8" /><th className="py-1.5">Question / answer</th><th className="px-2">Pipeline</th><th className="px-2">Review</th><th className="px-2">Chunks</th><th className="w-8" /></tr>
              </thead>
              <tbody>
                {shown.map((a) => {
                  const rel = relevantOf(a)
                  const irr = Object.values(a.chunk_labels ?? {}).filter((v) => v === 'irrelevant').length
                  return (
                    <tr key={a.id} className="border-t border-line/60 align-top">
                      <td className="py-2 pl-2"><Tip content="Run this question again in the panes"><button onClick={() => rerun(a.question)} className="rounded p-1 text-accent hover:bg-accent/10"><Play className="h-3 w-3" /></button></Tip></td>
                      <td className="max-w-[520px] py-2 pr-2">
                        <div className="font-medium leading-snug text-fg">{a.question}</div>
                        <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted">{a.answer || <i>no answer</i>}</div>
                        {a.note && <div className="mt-1 flex gap-1 text-[11.5px] text-fg"><MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-subtle" />{a.note}</div>}
                      </td>
                      <td className="px-2 py-2 text-muted">{a.pipeline || a.pane}</td>
                      <td className="px-2 py-2">
                        {a.verdict === 'up' ? <Badge tone="good"><ThumbsUp className="h-2.5 w-2.5" />good</Badge>
                          : a.verdict === 'down' ? <Badge tone="bad"><ThumbsDown className="h-2.5 w-2.5" />bad</Badge>
                            : <span className="text-subtle">–</span>}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-1">
                          {rel.map((c) => <Badge key={c} tone="good"><Check className="h-2.5 w-2.5" />{c}</Badge>)}
                          {irr > 0 && <Badge tone="bad"><X className="h-2.5 w-2.5" />{irr}</Badge>}
                          {!rel.length && !irr && <span className="text-subtle">–</span>}
                        </div>
                      </td>
                      <td className="py-2 pr-2"><Tip content="Delete annotation"><button onClick={() => remove(a.id)} className="rounded p-1 text-subtle hover:bg-bad/10 hover:text-bad"><Trash2 className="h-3 w-3" /></button></Tip></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <Agreement docId={docId} rated={counts.up + counts.down} />
    </div>
  )
}

/** Re-judge every thumbs-rated answer and measure how often the judge agrees with the human. */
function Agreement({ docId, rated }: { docId: string; rated: number }) {
  const [judge, setJudge] = useState<'heuristic' | 'llm'>('heuristic')
  const [llm, setLlm] = useState<LlmChoice>({ provider: 'default', model: '' })
  const [threshold, setThreshold] = useState(3)
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null)
  const [res, setRes] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)

  const run = async () => {
    setErr(null)
    setProg({ done: 0, total: rated })
    try {
      await sse('/api/annotations/agreement', {
        doc_id: docId, threshold,
        judge: judge === 'llm' ? { component: 'llm', params: { provider: llm.provider, model: llm.model } } : { component: 'heuristic', params: {} },
      }, (ev, d) => {
        if (ev === 'progress') setProg({ done: d.done, total: d.total })
        if (ev === 'result') setRes(d)
        if (ev === 'fatal') setErr(d.message)
      })
    } catch (e: any) { setErr(e.message) } finally { setProg(null) }
  }

  const pct = res?.agreement === null || res?.agreement === undefined ? '–' : `${Math.round(res.agreement * 100)}%`
  const cm = res?.confusion
  return (
    <aside className="w-[320px] shrink-0 space-y-3 overflow-y-auto border-l border-line p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle"><Scale className="h-3 w-3" />Judge vs. you</div>
      <p className="text-[11.5px] leading-relaxed text-muted">Re-scores every answer you rated 👍/👎 with a judge and shows how often it agrees with you. Low agreement means the judge's Batch Eval scores aren't trustworthy for this document.</p>
      <div className="flex items-center justify-between text-xs text-muted">Judge
        <Segmented size="xs" value={judge} onChange={setJudge} options={[{ value: 'heuristic', label: 'Heuristic' }, { value: 'llm', label: 'LLM' }]} />
      </div>
      {judge === 'llm' && <LlmPicker compact value={llm} onChange={setLlm} />}
      <div className="flex items-center justify-between text-xs text-muted">
        <Tip content={judge === 'heuristic' ? 'Heuristic: faithfulness score (1-5). Annotations have no reference answer, so correctness is not used.' : 'LLM judge: correctness score (1-5)'}>
          <span className="cursor-help">Pass if score ≥</span>
        </Tip>
        <Segmented size="xs" value={threshold} onChange={setThreshold} options={[2, 3, 4].map((v) => ({ value: v, label: String(v) }))} />
      </div>
      <Button variant="primary" className="w-full" disabled={!!prog || !rated} onClick={run}>
        {prog ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scale className="h-3.5 w-3.5" />}
        {prog ? `Judging ${prog.done}/${prog.total}` : rated ? `Check agreement on ${rated} answer${rated > 1 ? 's' : ''}` : 'Rate some answers first'}
      </Button>
      {err && <div className="text-[11px] text-bad">{err}</div>}
      {res && (
        <div className="space-y-3">
          <div className="flex items-baseline gap-2">
            <span className={cn('num text-2xl font-semibold', res.agreement >= 0.8 ? 'text-good' : res.agreement >= 0.6 ? 'text-warn' : 'text-bad')}>{pct}</span>
            <span className="text-[11.5px] text-muted">agreement on {res.n} answers</span>
          </div>
          {cm && (
            <table className="w-full text-center text-[11.5px]">
              <thead><tr className="text-[10.5px] text-subtle"><th /><th className="pb-1 font-medium">judge pass</th><th className="pb-1 font-medium">judge fail</th></tr></thead>
              <tbody>
                <tr><td className="py-1 text-left text-muted">you 👍</td><td className="num rounded bg-good/10 py-1 text-good">{cm.up_pass}</td><td className="num rounded bg-bad/10 py-1 text-bad">{cm.up_fail}</td></tr>
                <tr><td className="py-1 text-left text-muted">you 👎</td><td className="num rounded bg-bad/10 py-1 text-bad">{cm.down_pass}</td><td className="num rounded bg-good/10 py-1 text-good">{cm.down_fail}</td></tr>
              </tbody>
            </table>
          )}
          {res.rows.some((r: any) => r.agree === false) && (
            <div>
              <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-subtle">Disagreements</div>
              <div className="space-y-1.5">
                {res.rows.filter((r: any) => r.agree === false).map((r: any) => (
                  <div key={r.id} className="rounded-md border border-line p-2 text-[11.5px]">
                    <div className="leading-snug text-fg">{r.question}</div>
                    <div className="mt-0.5 text-subtle">you {r.human === 'up' ? '👍' : '👎'} · judge {r.judge_score?.toFixed?.(1) ?? '–'}/5 {r.judge_pass ? 'pass' : 'fail'}</div>
                    {r.rationale && r.rationale !== 'heuristic' && <div className="mt-0.5 text-muted">{r.rationale}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
