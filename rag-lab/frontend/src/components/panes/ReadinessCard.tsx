import { CheckCircle2, CircleDashed, CircleSlash, Info, PlugZap, Settings2, Wrench } from 'lucide-react'
import type { Readiness, ReadinessCheck } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { Button } from '@/components/ui'

const ICON: Record<ReadinessCheck['state'], { icon: typeof CheckCircle2; cls: string; word: string }> = {
  ok: { icon: CheckCircle2, cls: 'text-good', word: 'ready' },
  missing: { icon: CircleSlash, cls: 'text-warn', word: 'missing' },
  pending: { icon: CircleDashed, cls: 'text-subtle', word: 'pending' },
  fallback: { icon: Info, cls: 'text-accent', word: 'fallback' },
  info: { icon: Info, cls: 'text-subtle', word: '' },
}

/** Shown instead of an answer when a semantic/hybrid pane is wired up but missing an embedding model or vector DB. */
export function ReadinessCard({ report }: { report: Readiness }) {
  const openSettings = useApp((s) => s.setSettingsOpen)
  const pct = Math.round((report.ok_count / Math.max(1, report.total)) * 100)
  return (
    <div className="overflow-hidden rounded-xl border border-warn/40 bg-surface shadow-card">
      <div className="flex items-start gap-2.5 border-b border-line/70 bg-warn/[0.06] px-3 py-2.5">
        <PlugZap className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-fg">{report.headline}</div>
          <div className="mt-1 text-[12.5px] italic leading-relaxed text-muted">“{report.quip}”</div>
        </div>
      </div>
      <div className="px-3 py-2.5">
        <div className="mb-2 flex items-center gap-2 text-[11px] text-subtle">
          <span className="font-semibold uppercase tracking-wider">Pre-flight check</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-good transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="num">{report.ok_count}/{report.total} ready</span>
        </div>
        <ul className="space-y-1.5">
          {report.checks.map((c) => {
            const m = ICON[c.state] ?? ICON.info
            const Icon = m.icon
            return (
              <li key={c.id} className="flex items-start gap-2 text-[12px]">
                <Icon className={cn('mt-[1px] h-3.5 w-3.5 shrink-0', m.cls)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="font-medium text-fg">{c.label}</span>
                    {m.word && <span className={cn('text-[10.5px] font-semibold uppercase tracking-wide', m.cls)}>{m.word}</span>}
                  </div>
                  {c.detail && <div className="break-words text-[11.5px] leading-snug text-muted">{c.detail}</div>}
                  {c.fix && c.state === 'missing' && (
                    <div className="mt-0.5 flex items-start gap-1 break-words text-[11.5px] leading-snug text-accent">
                      <Wrench className="mt-[2px] h-3 w-3 shrink-0" />{c.fix}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" onClick={() => openSettings(true)}><Settings2 className="h-3 w-3" />Open settings</Button>
          <span className="text-[11px] text-subtle">Everything else on this pane is set up. Once the missing piece is there, just run again.</span>
        </div>
      </div>
    </div>
  )
}
