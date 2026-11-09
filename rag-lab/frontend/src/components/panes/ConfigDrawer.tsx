import { useState } from 'react'
import { motion } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import { History, Save, Trash2, X } from 'lucide-react'
import { del, post } from '@/api/client'
import { matchingVersion, usePromptVersions, withPrompt } from '@/lib/prompts'
import type { PaneId, StageName } from '@/lib/types'
import { STAGE_LABEL } from '@/lib/types'
import { effectiveParams, findComponent, fmtMs } from '@/lib/utils'
import { useApp } from '@/store/app'
import { useSuggestions } from '@/api/hooks'
import { Badge, Button, Popover, PopoverContent, PopoverTrigger, Select, Switch, Tip } from '@/components/ui'
import { SchemaForm } from '@/components/schema/SchemaForm'
import { DiffBadge } from '@/components/schema/DiffBadge'
import { JsonBlock } from '@/components/common/JsonView'
import type { PaneDiff } from '@/lib/diff'

const STAGE_HELP: Record<StageName, string> = {
  query_transform: 'Rewrites the question before retrieval. Off: the raw question is used.',
  chunking: 'How the document is split. Off: the whole document is one chunk (long-context baseline).',
  retrieval: 'Finds candidate chunks. Off: closed-book baseline, so the LLM answers with no context.',
  fusion: 'Merges BM25 and dense lists (hybrid only). Off: the lists are interleaved round-robin.',
  rerank: 'Re-scores the retrieved chunks. Off: retrieval order is kept.',
  context_filter: 'Threshold, dedupe, neighbours, merge, token budget. Off: everything is kept.',
  prompt: 'Builds the final prompt. Off: bare context + question.',
  generation: 'The LLM call. Off: a retrieval-only run.',
}

export function ConfigDrawer({ pane, stage, diff }: { pane: PaneId; stage: StageName; diff: PaneDiff }) {
  const reg = useApp((s) => s.registry)
  const sc = useApp((s) => s.panes[pane].stages[stage])
  const st = useApp((s) => s.runs[pane].stages[stage])
  const sync = useApp((s) => s.sync)
  const a = useApp.getState()
  const sugg = useSuggestions()
  const comps = reg?.stages.find((x) => x.stage === stage)?.components ?? []
  const comp = findComponent(reg, stage, sc.component)
  const d = diff[stage]
  const values = effectiveParams(reg, stage, sc.component, sc.params)

  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }} className="overflow-hidden border-b border-line">
      {/* natural height: the pane body scrolls as one, so the output below is never squeezed */}
      <div className="@container bg-surface/60 px-3 pb-3 pt-2.5">
        <div className="mb-2 flex items-center gap-2">
          <Switch size="sm" checked={sc.enabled} onCheckedChange={(v) => a.setStageEnabled(pane, stage, v)} aria-label="Stage enabled" />
          <span className="text-[13px] font-semibold">{STAGE_LABEL[stage]}</span>
          {d?.enabled && <DiffBadge title={d.enabled} />}
          {sync && stage !== 'retrieval' && stage !== 'fusion' && <Badge tone="accent">sync</Badge>}
          {sync && (stage === 'retrieval' || stage === 'fusion') && <Badge>locked</Badge>}
          <div className="ml-auto flex items-center gap-1">
            {st?.ms !== undefined && <span className="num text-[11px] text-subtle">{fmtMs(st.ms)}</span>}
            <Button size="iconSm" variant="ghost" onClick={() => a.setOpenDrawer(pane, null)} aria-label="Close"><X className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
        <p className="mb-2.5 text-[11.5px] leading-relaxed text-subtle">{STAGE_HELP[stage]}</p>
        <div className="mb-2.5 flex items-center gap-2">
          <Select className="min-w-[180px]" value={sc.component} onChange={(v) => a.setStageComponent(pane, stage, v)}
            options={comps.map((c) => ({ value: c.name, label: c.label, hint: c.description }))} />
          {d?.component && <DiffBadge title={d.component} />}
        </div>
        {comp?.description && <p className="mb-3 text-[11.5px] leading-relaxed text-muted">{comp.description}</p>}
        {stage === 'prompt' && <PromptVersions pane={pane} />}
        <div className={sc.enabled ? '' : 'pointer-events-none opacity-50'}>
          <SchemaForm schema={comp?.schema} values={values} explicit={sc.params} diff={d?.params} suggestions={sugg}
            onChange={(k, v) => a.setParam(pane, stage, k, v)} onReset={(k) => a.resetParam(pane, stage, k)} />
        </div>
        {(st?.trace || st?.error || st?.reason) && (
          <div className="mt-3 rounded-lg border border-line bg-bg/60 p-2">
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-subtle">Last run output</div>
            {st.error && <div className="mb-1 text-xs text-bad">{st.error}</div>}
            {st.reason && <div className="mb-1 text-xs text-muted">{st.reason}</div>}
            {st.trace && <JsonBlock data={st.trace} />}
          </div>
        )}
      </div>
    </motion.div>
  )
}

/** Named prompt versions: load one into this pane, save the current prompt as a version, or update/delete one. */
function PromptVersions({ pane }: { pane: PaneId }) {
  const reg = useApp((s) => s.registry)
  const cfg = useApp((s) => s.panes[pane])
  const qc = useQueryClient()
  const { data: versions } = usePromptVersions()
  const match = matchingVersion(reg, cfg, versions)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const load = (id: string) => {
    const v = versions?.find((x) => x.id === id)
    if (v) useApp.getState().replacePane(pane, withPrompt(useApp.getState().panes[pane], v))
  }
  const save = async (n: string, nt: string) => {
    setErr(null)
    try {
      const sc = useApp.getState().panes[pane].stages.prompt
      await post('/api/prompts', { name: n, note: nt, component: sc.component, params: effectiveParams(reg, 'prompt', sc.component, sc.params) })
      await qc.invalidateQueries({ queryKey: ['prompts'] })
      setOpen(false); setName(''); setNote('')
    } catch (e: any) { setErr(e.message) }
  }
  const remove = async (id: string) => {
    await del(`/api/prompts/${encodeURIComponent(id)}`)
    qc.invalidateQueries({ queryKey: ['prompts'] })
  }

  return (
    <div className="mb-3 rounded-lg border border-line bg-bg/60 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <History className="h-3 w-3 text-subtle" />
        <span className="text-[11.5px] font-medium text-muted">Prompt version</span>
        {match ? <Badge tone="accent">{match.name}</Badge> : <Badge>{versions?.length ? 'unsaved changes' : 'none saved'}</Badge>}
        <div className="ml-auto flex items-center gap-1">
          {!!versions?.length && (
            <Select className="w-[150px]" value={match?.id ?? ''} placeholder="Load version…" onChange={load}
              options={versions.map((v) => ({ value: v.id, label: v.name, hint: v.note || new Date(v.updated * 1000).toLocaleString() }))} />
          )}
          <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) { setName(match?.name ?? ''); setNote(match?.note ?? '') } }}>
            <PopoverTrigger asChild><Button size="sm" variant="secondary"><Save className="h-3 w-3" />Save</Button></PopoverTrigger>
            <PopoverContent className="w-[280px] space-y-2 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Save prompt version</div>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. v2-concise" maxLength={80}
                className="h-7 w-full rounded-md border border-line bg-surface px-2 text-[12px] focus:border-accent/70 focus:outline-none" />
              <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed? (optional)" rows={2} maxLength={500}
                className="w-full resize-none rounded-md border border-line bg-surface px-2 py-1 text-[12px] focus:border-accent/70 focus:outline-none" />
              {versions?.some((v) => v.name === name.trim()) && <div className="text-[11px] text-warn">Overwrites the existing “{name.trim()}”.</div>}
              {err && <div className="text-[11px] text-bad">{err}</div>}
              <Button size="sm" variant="primary" className="w-full" disabled={!name.trim()} onClick={() => save(name.trim(), note)}>Save</Button>
            </PopoverContent>
          </Popover>
          {match && <Tip content={`Delete version “${match.name}”`}><Button size="iconSm" variant="ghost" onClick={() => remove(match.id)}><Trash2 className="h-3 w-3" /></Button></Tip>}
        </div>
      </div>
      {match?.note && <div className="mt-1 text-[11px] text-subtle">{match.note}</div>}
    </div>
  )
}
