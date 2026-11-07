import { useEffect, useRef } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useApp, visiblePanes } from '@/store/app'
import { hashConfig } from '@/lib/utils'
import type { PaneId } from '@/lib/types'
import { PANE_IDS } from '@/lib/types'
import { Pane } from './Pane'

export function PaneArea() {
  const vis = useApp(visiblePanes)
  const maximized = useApp((s) => s.maximized)
  useAutoRun()
  const shown = maximized && vis.includes(maximized) ? [maximized] : vis
  return (
    // pane cards overlap the end of the blue band, like a hero section
    <div className="h-full bg-[linear-gradient(rgb(var(--brand))_0,rgb(var(--brand))_40px,transparent_40px)] px-3 pb-2">
      <Group key={shown.join('')} orientation="horizontal" className="h-full">
        {shown.map((p, i) => (
          <PanelWithSep key={p} pane={p} first={i === 0} size={String(100 / shown.length)} />
        ))}
      </Group>
    </div>
  )
}

function PanelWithSep({ pane, first, size }: { pane: PaneId; first: boolean; size: string }) {
  return (
    <>
      {!first && <Separator className="mx-1 my-6 w-[4px] rounded-full bg-transparent transition-colors hover:bg-brand/40 data-[separator=active]:bg-brand" />}
      <Panel id={pane} defaultSize={size} minSize="18" className="min-w-0">
        <Pane pane={pane} />
      </Panel>
    </>
  )
}

/** Auto-run: when on and a question is present, a config change re-runs that pane (600 ms debounce). */
function useAutoRun() {
  const timers = useRef<Partial<Record<PaneId, number>>>({})
  useEffect(() => {
    return useApp.subscribe((s, prev) => {
      if (!s.autoRun || !s.question.trim() || !s.docId) return
      for (const id of PANE_IDS.slice(0, s.paneCount)) {
        if (s.panes[id] === prev.panes[id]) continue
        const h = hashConfig(s.panes[id])
        if (h === hashConfig(prev.panes[id])) continue
        window.clearTimeout(timers.current[id])
        timers.current[id] = window.setTimeout(() => {
          const cur = useApp.getState()
          if (cur.runs[id].configHash !== hashConfig(cur.panes[id])) cur.runPanes([id], { saveHistory: false })
        }, 600)
      }
    })
  }, [])
}
