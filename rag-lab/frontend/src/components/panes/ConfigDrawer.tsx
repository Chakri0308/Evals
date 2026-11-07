import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { PaneId, StageName } from '@/lib/types'
import { STAGE_LABEL } from '@/lib/types'
import { effectiveParams, findComponent, fmtMs } from '@/lib/utils'
import { useApp } from '@/store/app'
import { useSuggestions } from '@/api/hooks'
import { Badge, Button, Select, Switch } from '@/components/ui'
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
