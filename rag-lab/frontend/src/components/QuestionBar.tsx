import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, History, Loader2, Trash2, Zap } from 'lucide-react'
import { api, del } from '@/api/client'
import { useApp, visiblePanes } from '@/store/app'
import { cn, modKey } from '@/lib/utils'
import { Button, Kbd, Popover, PopoverContent, PopoverTrigger, Switch, Tip } from '@/components/ui'

const EXAMPLES = [
  'Can I use exclamation marks in error messages?',
  'What does the guide say about Project Halcyon?',
  'How should I describe pictures for people using screen readers?',
  'If a legal notice says "Log in", which rule wins?',
  'What is the guide’s policy on writing SQL?',
]

export function QuestionBar() {
  const q = useApp((s) => s.question)
  const autoRun = useApp((s) => s.autoRun)
  const docId = useApp((s) => s.docId)
  const vis = useApp(visiblePanes)
  const runs = useApp((s) => s.runs)
  const a = useApp.getState()
  const ref = useRef<HTMLTextAreaElement>(null)
  const anyRunning = vis.some((p) => runs[p].status === 'running')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(140, el.scrollHeight) + 'px'
  }, [q])

  return (
    <div className="shrink-0 bg-brand px-4 pb-3 pt-1">
      <div className="flex items-start gap-2.5">
        <div className={cn('flex min-w-0 flex-1 items-start rounded-[24px] border-2 border-transparent bg-white px-4 py-2 shadow-card transition-colors focus-within:border-white focus-within:shadow-[0_0_0_4px_rgb(255_255_255/0.35)]')}>
          <textarea
            id="question-input"
            ref={ref}
            rows={1}
            value={q}
            onChange={(e) => a.setQuestion(e.target.value)}
            // Ctrl/⌘+Enter is handled once, globally (App.useShortcuts)
            placeholder={docId ? 'Ask the style guide anything…' : 'Upload or choose a document first'}
            className="min-h-[24px] w-full resize-none bg-transparent text-[15px] leading-6 text-[#0f1632] placeholder:text-[#808898] focus:outline-none"
          />
        </div>
        <Button variant="onBrand" size="lg" disabled={!q.trim() || !docId} onClick={() => a.runPanes()} className="h-[44px] gap-2.5 pl-5 pr-1.5 text-[14px] disabled:opacity-60">
          Run all
          <span className="rounded bg-brand/10 px-1 font-mono text-[10px] font-medium">{modKey}↵</span>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-white">
            {anyRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          </span>
        </Button>
        <div className="flex h-[44px] flex-col justify-center gap-1 text-white">
          <Tip content="Auto-run: config changes re-run the affected pane (600 ms debounce)">
            <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-white/90">
              <Zap className={cn('h-3 w-3', autoRun && 'text-[#ffd34d]')} />Auto-run
              <Switch size="sm" checked={autoRun} onCheckedChange={a.setAutoRun} aria-label="Auto-run" />
            </label>
          </Tip>
          <HistoryButton />
        </div>
      </div>
      {!q && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EXAMPLES.map((e) => (
            <button key={e} onClick={() => a.setQuestion(e)}
              className="rounded-full border border-white/40 bg-white/10 px-3 py-0.5 text-[11.5px] text-white transition-colors hover:bg-white hover:text-brand">{e}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function HistoryButton() {
  const open = useApp((s) => s.historyOpen)
  const last = useApp((s) => s.lastHistoryId)
  const a = useApp.getState()
  const { data, refetch } = useQuery({ queryKey: ['history', last], queryFn: () => api<any[]>('/api/history'), enabled: open })
  return (
    <Popover open={open} onOpenChange={a.setHistoryOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 text-[11.5px] text-white/90 hover:text-white"><History className="h-3 w-3" />History</button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-1.5">
        <div className="flex items-center px-2 pb-1.5 pt-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-subtle">Run history</span>
          <button className="ml-auto flex items-center gap-1 text-[11px] text-subtle hover:text-bad"
            onClick={async () => { await del('/api/history'); refetch() }}><Trash2 className="h-3 w-3" />Clear</button>
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          {!data?.length && <div className="px-2 py-6 text-center text-xs text-subtle">No runs yet. Every “Run all” is saved here.</div>}
          {data?.map((h) => (
            <button key={h.id} onClick={async () => a.loadHistoryRun(await api(`/api/history/${h.id}`))}
              className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent/10">
              <span className="truncate text-[12.5px] text-fg">{h.question}</span>
              <span className="flex gap-2 text-[10.5px] text-subtle">
                <span className="num">{new Date(h.ts * 1000).toLocaleString()}</span><span>{h.doc_name}</span><span>{h.panes.join(' · ')}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="border-t border-line px-2 pt-1.5 text-[10.5px] text-subtle">Shortcuts: <Kbd>{modKey}↵</Kbd> run all · <Kbd>{modKey}1-3</Kbd> panes · <Kbd>{modKey}B</Kbd> bottom panel · <Kbd>/</Kbd> focus · <Kbd>Esc</Kbd> close</div>
      </PopoverContent>
    </Popover>
  )
}
