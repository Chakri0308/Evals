import type { PaneId, PipelineConfig, Registry, StageName } from './types'
import { STAGES } from './types'
import { effectiveParams, findComponent } from './utils'

export interface StageDiff { enabled?: string; component?: string; params: Record<string, string> }
export type PaneDiff = Partial<Record<StageName, StageDiff>> & { _count?: number }

const show = (v: any) => (typeof v === 'string' ? (v.length > 24 ? v.slice(0, 22) + '…' : v) : JSON.stringify(v))

/** Which settings of `pane` differ from the other visible panes. Powers the ≠ badges. */
export function computeDiff(reg: Registry | undefined, panes: Record<PaneId, PipelineConfig>, visible: PaneId[], pane: PaneId): PaneDiff {
  const out: PaneDiff = {}
  let count = 0
  const me = panes[pane]
  const others = visible.filter((v) => v !== pane)
  if (!others.length || !me) return out
  for (const s of STAGES) {
    const d: StageDiff = { params: {} }
    const a = me.stages[s]
    const en: string[] = [], co: string[] = []
    const pd: Record<string, string[]> = {}
    for (const o of others) {
      const b = panes[o].stages[s]
      if (a.enabled !== b.enabled) en.push(`Pane ${o}: ${b.enabled ? 'on' : 'off'}`)
      if (a.component !== b.component) {
        co.push(`Pane ${o}: ${findComponent(reg, s, b.component)?.label ?? b.component}`)
        continue
      }
      const pa = effectiveParams(reg, s, a.component, a.params)
      const pb = effectiveParams(reg, s, b.component, b.params)
      for (const k of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
        if (JSON.stringify(pa[k]) !== JSON.stringify(pb[k])) (pd[k] ??= []).push(`Pane ${o}: ${show(pb[k])}`)
      }
    }
    if (en.length) { d.enabled = en.join('\n'); count++ }
    if (co.length) { d.component = co.join('\n'); count++ }
    for (const [k, v] of Object.entries(pd)) { d.params[k] = v.join('\n'); count++ }
    if (d.enabled || d.component || Object.keys(d.params).length) out[s] = d
  }
  out._count = count
  return out
}
