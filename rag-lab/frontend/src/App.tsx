import { Suspense, lazy, useEffect } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { ChevronDown, ChevronUp, FileText, FlaskConical, GitCompare, Loader2, Wand2 } from 'lucide-react'
import { useDocs, useRegistry } from '@/api/hooks'
import { useApp, type BottomTab } from '@/store/app'
import { cn } from '@/lib/utils'
import { Empty, Tabs, TooltipProvider } from '@/components/ui'
import { SettingsDialog } from '@/components/SettingsDialog'
import { useCapabilities } from '@/api/hooks'
import { modKey } from '@/lib/utils'
import { TopBar } from '@/components/TopBar'
import { QuestionBar } from '@/components/QuestionBar'
import { PaneArea } from '@/components/panes/PaneArea'

// bottom-panel tabs load on first use (keeps the initial bundle small)
const CompareTab = lazy(() => import('@/components/bottom/CompareTab').then((m) => ({ default: m.CompareTab })))
const QGenTab = lazy(() => import('@/components/bottom/QGenTab').then((m) => ({ default: m.QGenTab })))
const EvalTab = lazy(() => import('@/components/bottom/EvalTab').then((m) => ({ default: m.EvalTab })))
const DocumentView = lazy(() => import('@/components/bottom/DocumentView').then((m) => ({ default: m.DocumentView })))

export default function App() {
  const theme = useApp((s) => s.theme)
  const reg = useRegistry()
  const docs = useDocs()
  const docId = useApp((s) => s.docId)
  const bottomOpen = useApp((s) => s.bottomOpen)
  const registry = useApp((s) => s.registry)

  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark') }, [theme])
  useEffect(() => { if (reg.data) useApp.getState().setRegistry(reg.data) }, [reg.data])
  useEffect(() => {
    if (docs.data?.length && (!docId || !docs.data.some((d) => d.id === docId))) useApp.getState().setDoc(docs.data[0].id)
  }, [docs.data, docId])
  useShortcuts()

  if (reg.error) {
    return (
      <div className="flex h-full items-center justify-center">
        <Empty title="Backend not reachable">Start the API with <code className="font-mono">dev.ps1</code> (or uvicorn on :8000). Error: {String((reg.error as Error).message)}</Empty>
      </div>
    )
  }
  if (!registry) {
    return <div className="flex h-full items-center justify-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />Loading components…</div>
  }

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <TopBar />
        <QuestionBar />
        <div className="min-h-0 flex-1">
          {bottomOpen ? (
            <Group orientation="vertical" className="h-full">
              <Panel id="panes" defaultSize="60" minSize="25"><PaneArea /></Panel>
              <Separator className="mx-6 h-[4px] rounded-full bg-transparent transition-colors hover:bg-brand/40 data-[separator=active]:bg-brand" />
              <Panel id="bottom" defaultSize="40" minSize="15"><Bottom /></Panel>
            </Group>
          ) : (
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1"><PaneArea /></div>
              <Bottom collapsed />
            </div>
          )}
        </div>
        <Footer />
      </div>
      <SettingsDialog />
    </TooltipProvider>
  )
}

function Bottom({ collapsed }: { collapsed?: boolean }) {
  const tab = useApp((s) => s.bottomTab)
  const a = useApp.getState()
  return (
    <div className={cn('flex flex-col overflow-hidden border-t border-line bg-surface', collapsed ? '' : 'h-[calc(100%-0.25rem)]')}>
      <Tabs<BottomTab> className="shrink-0 px-2" value={tab} onChange={(t) => a.setBottom(t, true)}
        tabs={[
          { value: 'compare', label: 'Compare', icon: <GitCompare className="h-3 w-3" /> },
          { value: 'qgen', label: 'Question Generator', icon: <Wand2 className="h-3 w-3" /> },
          { value: 'eval', label: 'Batch Eval', icon: <FlaskConical className="h-3 w-3" /> },
          { value: 'document', label: 'Document view', icon: <FileText className="h-3 w-3" /> },
        ]}
        right={<button onClick={a.toggleBottom} className="rounded p-1 text-subtle hover:bg-elevated hover:text-fg" title="Toggle panel (Ctrl+B)">{collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</button>}
      />
      {!collapsed && (
        <div className="min-h-0 flex-1">
          <Suspense fallback={<div className="flex h-full items-center justify-center gap-2 text-xs text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…</div>}>
            {tab === 'compare' && <CompareTab />}
            {tab === 'qgen' && <QGenTab />}
            {tab === 'eval' && <EvalTab />}
            {tab === 'document' && <DocumentView />}
          </Suspense>
        </div>
      )}
    </div>
  )
}

function Footer() {
  const { data } = useCapabilities()
  const mode = data?.mode
  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-line bg-surface px-4 text-[10.5px] text-subtle">
      <span className="font-medium text-muted">RAG Lab</span>
      {mode && <span>{mode === 'full' ? 'LLM + embeddings on' : mode === 'no_llm' ? 'No-LLM mode · answers are extractive' : mode === 'offline' ? 'Offline mode · BM25 + extractive answers' : 'Embeddings off'}</span>}
      {data && <span>LLM {data.settings.llm_provider}{data.settings.llm_model ? ` · ${data.settings.llm_model}` : ''} · vector DB {data.settings.vector_store}</span>}
      <span className="ml-auto">{modKey}↵ run all · {modKey}1-3 panes · {modKey}B bottom panel · / focus · Esc close</span>
    </footer>
  )
}

function useShortcuts() {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const a = useApp.getState()
      const mod = e.metaKey || e.ctrlKey
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName)
      if (mod && e.key === 'Enter') { e.preventDefault(); a.runPanes() }
      else if (mod && ['1', '2', '3'].includes(e.key)) { e.preventDefault(); a.setPaneCount(+e.key as 1 | 2 | 3) }
      else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); a.toggleBottom() }
      else if (e.key === 'Escape') {
        if (a.maximized) a.setMaximized(null)
        for (const p of ['A', 'B', 'C'] as const) a.setOpenDrawer(p, null)
      } else if (e.key === '/' && !typing) { e.preventDefault(); document.getElementById('question-input')?.focus() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
}
