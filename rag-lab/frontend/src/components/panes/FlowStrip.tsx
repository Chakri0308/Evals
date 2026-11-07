import { Fragment } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Power } from 'lucide-react'
import type { PaneId, StageName } from '@/lib/types'
import { STAGES, STAGE_LABEL } from '@/lib/types'
import { cn, findComponent, fmtMs } from '@/lib/utils'
import { useApp } from '@/store/app'
import { Tip } from '@/components/ui'
import type { PaneDiff } from '@/lib/diff'

/** The horizontal stage graph at the top of each pane. */
export function FlowStrip({ pane, diff }: { pane: PaneId; diff: PaneDiff }) {
  const cfg = useApp((s) => s.panes[pane])
  const run = useApp((s) => s.runs[pane])
  const reg = useApp((s) => s.registry)
  const open = useApp((s) => s.openDrawer[pane])
  const setOpen = useApp((s) => s.setOpenDrawer)
  const setEnabled = useApp((s) => s.setStageEnabled)

  return (
    <div className="flex items-stretch overflow-x-auto px-3 pb-2.5 pt-0.5">
      {STAGES.map((s, i) => {
        const sc = cfg.stages[s]
        const st = run.stages[s]
        const status = st?.status
        const enabled = sc.enabled
        const comp = findComponent(reg, s, sc.component)
        const running = status === 'running'
        const skipped = status === 'skipped' || (!enabled && !status)
        const nextEnabled = i < STAGES.length - 1 && cfg.stages[STAGES[i + 1]].enabled
        const hasDiff = !!diff[s]
        const count = st?.count_out
        const countLabel = count === undefined ? null : s === 'prompt' ? `${count}t` : s === 'generation' ? `${count}t` : String(count)
        return (
          <Fragment key={s}>
            <Tip content={<StageTip stage={s} label={comp?.label} st={st} enabled={enabled} />}>
              <motion.button
                layout
                onClick={() => setOpen(pane, open === s ? null : s)}
                className={cn(
                  'group relative flex min-w-[54px] flex-1 basis-0 flex-col items-start overflow-hidden rounded-lg border px-1.5 py-1.5 text-left transition-colors',
                  open === s ? 'border-pc bg-pc-soft' : 'border-line bg-surface hover:border-subtle/50',
                  !enabled && 'border-dashed opacity-55',
                  running && 'ring-pc animate-pulsering',
                  status === 'error' && 'border-bad/60 bg-bad/5',
                  status === 'not_ready' && 'border-warn/60 bg-warn/5',
                )}
              >
                <div className="flex w-full items-center gap-1">
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full',
                    status === 'error' ? 'bg-bad' : status === 'not_ready' ? 'bg-warn' : running ? 'bg-pc' : !enabled || status === 'skipped' ? 'bg-subtle/50' : status === 'ok' ? 'bg-good' : 'bg-line')} />
                  <span className={cn('truncate text-[11px] font-semibold', enabled ? 'text-fg' : 'text-subtle line-through decoration-subtle/50')}>{STAGE_LABEL[s]}</span>
                  {hasDiff && <span className="font-mono text-[9.5px] font-bold text-warn">≠</span>}
                  <span
                    role="button"
                    aria-label={enabled ? `Disable ${STAGE_LABEL[s]}` : `Enable ${STAGE_LABEL[s]}`}
                    onClick={(e) => { e.stopPropagation(); setEnabled(pane, s, !enabled) }}
                    className={cn('absolute right-0.5 top-1 rounded bg-surface p-0.5 opacity-0 transition-opacity hover:bg-elevated group-hover:opacity-100', enabled ? 'text-good' : 'text-subtle')}
                  >
                    <Power className="h-2.5 w-2.5" />
                  </span>
                </div>
                <div className="mt-0.5 w-full truncate text-[10.5px] text-muted">
                  {enabled ? (comp?.label ?? sc.component).replace(/ \(.*\)$/, '') : 'off'}
                </div>
                <div className="mt-0.5 flex h-3.5 w-full items-center gap-1 overflow-hidden whitespace-nowrap font-mono text-[10px] tabular-nums text-subtle">
                  {status === 'error' ? <AlertTriangle className="h-2.5 w-2.5 text-bad" /> :
                    skipped ? <span>skipped</span> : (
                      <>
                        {st?.ms !== undefined && <span>{fmtMs(st.ms)}</span>}
                        {countLabel && <span className="text-pc">· {countLabel}</span>}
                      </>
                    )}
                </div>
              </motion.button>
            </Tip>
            {i < STAGES.length - 1 && (
              <div className="flex w-1.5 shrink-0 items-center">
                <div className={cn('h-px w-full', nextEnabled && enabled ? 'bg-subtle/50' : 'border-t border-dashed border-subtle/40')} />
              </div>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

function StageTip({ stage, label, st, enabled }: { stage: StageName; label?: string; st?: any; enabled: boolean }) {
  return (
    <div className="space-y-0.5">
      <div className="font-semibold">{STAGE_LABEL[stage]} · {enabled ? label : 'disabled'}</div>
      {st?.reason && <div className="text-muted">{st.reason}</div>}
      {st?.error && <div className="text-bad">{st.error}</div>}
      {st?.count_in !== undefined && <div className="font-mono text-muted">{st.count_in} → {st.count_out} · {fmtMs(st.ms)}</div>}
      <div className="text-subtle">Click to configure · hover ⏻ to toggle</div>
    </div>
  )
}
