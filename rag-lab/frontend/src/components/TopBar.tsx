import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Columns2, Columns3, FileText, Link2, Loader2, Moon, RotateCcw, Settings2, Square, Sun, Upload } from 'lucide-react'
import { api } from '@/api/client'
import { useDocs } from '@/api/hooks'
import { useApp } from '@/store/app'
import { cn } from '@/lib/utils'
import { Button, Segmented, Select, Switch, Tip } from '@/components/ui'
import { ModeChip } from '@/components/SettingsDialog'

export function TopBar() {
  const { data: docs } = useDocs()
  const docId = useApp((s) => s.docId)
  const paneCount = useApp((s) => s.paneCount)
  const sync = useApp((s) => s.sync)
  const theme = useApp((s) => s.theme)
  const runs = useApp((s) => s.runs)
  const a = useApp.getState()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const doc = docs?.find((d) => d.id === docId)
  const chunks = runs.A.result?.num_chunks ?? runs.B.result?.num_chunks

  const upload = async (f: File) => {
    setUploading(true)
    setErr(null)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const r = await api<any>('/api/documents', { method: 'POST', body: fd })
      await qc.invalidateQueries({ queryKey: ['docs'] })
      a.setDoc(r.id)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 bg-brand px-4 text-white">
      <div className="flex items-baseline gap-2 pr-1">
        <span className="text-[19px] font-bold tracking-tight">RAG Lab</span>
        <span className="font-display-serif hidden text-[15px] text-white/85 xl:inline">find the right answer, side by side</span>
      </div>
      <div className="h-6 w-px bg-white/30" />
      <div className="flex min-w-0 items-center gap-1.5">
        <FileText className="h-3.5 w-3.5 shrink-0 text-white/80" />
        <Select className="h-8 w-[220px] rounded-full border-white/0 bg-white px-3 text-navy dark:bg-white dark:text-[#0f1632]" value={docId ?? ''} placeholder="Choose a document"
          onChange={(v) => a.setDoc(v)}
          options={(docs ?? []).map((d) => ({ value: d.id, label: d.name, hint: `${d.kind.toUpperCase()} · ${d.tokens.toLocaleString()} tokens` }))} />
        <input ref={fileRef} type="file" accept=".md,.markdown,.pdf,.txt" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
        <Tip content="Upload a style guide (.md or .pdf)">
          <Button size="sm" variant="onBrand" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}Upload
          </Button>
        </Tip>
        {err && <span className="max-w-[200px] truncate rounded bg-white px-1.5 text-[11px] text-bad" title={err}>{err}</span>}
      </div>
      {doc && (
        <div className="hidden items-center gap-3 font-mono text-[11px] tabular-nums text-white/75 2xl:flex [&_.text-fg]:text-white">
          {doc.kind === 'pdf' && <span><span className="text-fg">{doc.pages}</span> pages</span>}
          <span><span className="text-fg">{doc.tokens.toLocaleString()}</span> tokens</span>
          <span><span className="text-fg">{doc.sections}</span> headings</span>
          {chunks !== undefined && <span><span className="text-fg">{chunks}</span> chunks</span>}
        </div>
      )}
      <div className="ml-auto flex items-center gap-2">
        <ModeChip />
        <Tip content="Models, vector DB & access (LLM on/off, embeddings on/off)">
          <Button size="icon" variant="ghost" className="text-white hover:bg-white/15 hover:text-white" aria-label="Settings" onClick={() => a.setSettingsOpen(true)}><Settings2 className="h-4 w-4" /></Button>
        </Tip>
        <Tip content="Reset all panes to the default BM25 / Semantic / Hybrid presets">
          <Button size="sm" variant="ghost" className="text-white hover:bg-white/15 hover:text-white" onClick={() => a.resetPanes()}><RotateCcw className="h-3 w-3" />Presets</Button>
        </Tip>
        <Segmented className="border-white/30 bg-white/15 [&_button]:text-white [&_button.bg-brand]:bg-white [&_button.bg-brand]:!text-brand" value={paneCount} onChange={(v) => a.setPaneCount(v as 1 | 2 | 3)}
          options={[
            { value: 1, label: <Square className="h-3 w-3" />, title: '1 pane (Ctrl+1)' },
            { value: 2, label: <Columns2 className="h-3 w-3" />, title: '2 panes (Ctrl+2)' },
            { value: 3, label: <Columns3 className="h-3 w-3" />, title: '3 panes (Ctrl+3)' },
          ]} />
        <Tip content="Sync settings: a change applies to every pane, except the retrieval type and fusion (locked)">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-white/90">
            <Link2 className={cn('h-3.5 w-3.5', sync && 'text-white')} />Sync
            <Switch size="sm" checked={sync} onCheckedChange={a.setSync} aria-label="Sync settings" />
          </label>
        </Tip>
        <Tip content="Toggle theme">
          <Button size="icon" variant="ghost" className="text-white hover:bg-white/15 hover:text-white" onClick={() => a.setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </Button>
        </Tip>
      </div>
    </header>
  )
}
