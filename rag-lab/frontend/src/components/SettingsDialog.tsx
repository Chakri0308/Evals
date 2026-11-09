import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useQueryClient } from '@tanstack/react-query'
import { Bot, Check, Database, Loader2, Lock, PlugZap, RefreshCw, ShieldOff, Sparkles, X } from 'lucide-react'
import { api, post, put } from '@/api/client'
import { useCapabilities, useStatus } from '@/api/hooks'
import type { AppSettings, Capabilities } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { Badge, Button, Select, Switch, Tip } from '@/components/ui'

const MODE_LABEL: Record<Capabilities['mode'], { text: string; tone: 'good' | 'warn' | 'accent' }> = {
  full: { text: 'All systems on', tone: 'good' },
  no_llm: { text: 'No-LLM mode', tone: 'warn' },
  no_embeddings: { text: 'No-embeddings mode', tone: 'warn' },
  offline: { text: 'Offline mode', tone: 'warn' },
}

const save = (changes: Partial<AppSettings>) => put<{ settings: AppSettings }>('/api/settings', changes)

export function ModeChip() {
  const { data } = useCapabilities()
  const open = useApp((s) => s.setSettingsOpen)
  if (!data) return null
  const m = MODE_LABEL[data.mode]
  const llm = data.llms.find((l) => l.name === data.settings.llm_provider)
  return (
    <Tip content={<div className="space-y-0.5">
      <div>LLM: {llm?.label ?? data.settings.llm_provider} {data.settings.llm_model && `· ${data.settings.llm_model}`} {data.settings.allow_llm ? (llm?.ready ? '✓' : '(not ready)') : '(switched off)'}</div>
      <div>Embeddings: {data.settings.embedding_model} {data.settings.allow_embeddings ? '' : '(switched off)'}</div>
      <div>Vector DB: {data.settings.vector_store}</div>
      <div className="text-muted">Click to change</div>
    </div>}>
      <button onClick={() => open(true)} className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[11px] font-medium text-muted hover:border-subtle/70 hover:text-fg">
        <span className={cn('h-1.5 w-1.5 rounded-full', m.tone === 'good' ? 'bg-good' : 'bg-warn')} />
        {m.text}
        <span className="text-subtle">· {llm?.label ?? data.settings.llm_provider} · {data.settings.vector_store}</span>
      </button>
    </Tip>
  )
}

export function SettingsDialog() {
  const open = useApp((s) => s.settingsOpen)
  const setOpen = useApp((s) => s.setSettingsOpen)
  const applyLlmToAll = useApp((s) => s.applyLlmToAll)
  const followDefaults = useApp((s) => s.followDefaultRetrieval)
  const qc = useQueryClient()
  const { data: caps, refetch, isFetching } = useCapabilities()
  const { data: status } = useStatus()
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [ping, setPing] = useState<{ busy?: boolean; ok?: boolean; detail?: string } | null>(null)

  useEffect(() => { if (open && caps) setDraft(caps.settings) }, [open, caps?.settings])  // eslint-disable-line react-hooks/exhaustive-deps
  if (!caps || !draft) return null
  const locks = caps.locks
  const llmRows = caps.llms
  const cur = llmRows.find((r) => r.name === draft.llm_provider)
  const modelSuggest = draft.llm_provider === 'ollama' ? status?.ollama.models ?? [] : cur?.examples ?? []
  const dirty = JSON.stringify(draft) !== JSON.stringify(caps.settings)

  const refreshAll = async (fresh = false) => {
    if (fresh) await api('/api/capabilities?refresh=true')
    await Promise.all([refetch(), qc.invalidateQueries({ queryKey: ['status'] }), qc.invalidateQueries({ queryKey: ['components'] })])
  }
  const commit = async (changes: Partial<AppSettings>, note: string) => {
    try {
      await save(changes)
      await refreshAll(true)
      setMsg(note)
    } catch (e: any) { setMsg(e.message) }
  }
  const testLlm = async () => {
    setPing({ busy: true })
    try { setPing(await post(`/api/llm/${draft.llm_provider}/ping`)) } catch (e: any) { setPing({ ok: false, detail: e.message }) }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { setOpen(v); setMsg(null); setPing(null) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgb(var(--overlay)/0.4)]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[min(760px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-glow">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3">
            <Dialog.Title className="text-[15px] font-semibold tracking-tight">Models, vector DB &amp; access</Dialog.Title>
            <Badge className="ml-1">{MODE_LABEL[caps.mode].text}</Badge>
            <div className="ml-auto flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => refreshAll(true)}>
                {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}Re-check connections
              </Button>
              <Dialog.Close className="rounded-md p-1 text-muted hover:bg-elevated hover:text-fg" aria-label="Close"><X className="h-4 w-4" /></Dialog.Close>
            </div>
          </div>
          <Dialog.Description className="sr-only">Choose the LLM, embedding model and vector database, and what this machine may call.</Dialog.Description>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {/* --- access policy */}
            <Section icon={<ShieldOff className="h-3.5 w-3.5" />} title="What this machine may call"
              hint="For locked-down environments. With LLM calls off, BM25 still retrieves and answers by quoting the best sentences (with citations). With embeddings off, semantic and hybrid panes run a pre-flight check and tell you what's missing.">
              <PolicyRow label="LLM calls" sub="Answers, query rewriting, LLM reranker, question generator, LLM judge" checked={caps.settings.allow_llm}
                lock={locks.allow_llm} onChange={(v) => commit({ allow_llm: v }, v ? 'LLM calls switched on.' : 'LLM calls switched off: answers fall back to extractive quotes.')} />
              <PolicyRow label="Embedding / reranker models" sub="Semantic & hybrid search, cross-encoder and MMR rerankers, semantic chunker" checked={caps.settings.allow_embeddings}
                lock={locks.allow_embeddings} onChange={(v) => commit({ allow_embeddings: v }, v ? 'Embedding models switched on.' : 'Embedding models switched off.')} />
            </Section>

            {/* --- LLM */}
            <Section icon={<Bot className="h-3.5 w-3.5" />} title="Default LLM" hint="Used by new panes, the question generator and the judge ('default'). Keys live in rag-lab/.env, never in the UI.">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {llmRows.map((r) => (
                  <button key={r.name} onClick={() => setDraft({ ...draft, llm_provider: r.name, llm_model: '' })}
                    className={cn('flex items-start gap-2 rounded-xl border px-3 py-2 text-left transition-colors',
                      draft.llm_provider === r.name ? 'border-brand bg-brand/[0.06] ring-1 ring-brand' : 'border-line hover:border-brand/50')}>
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', r.ready ? 'bg-good' : 'bg-subtle/50')} />
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-semibold text-fg">{r.label}</span>
                      <span className="block truncate text-[11px] text-muted" title={r.detail}>{r.ready ? (r.uses_model ? `ready${r.default_model ? ` · ${r.default_model}` : ''}` : 'no model: quotes the context') : r.detail}</span>
                    </span>
                  </button>
                ))}
              </div>
              {cur?.uses_model && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted">Model</span>
                  <input list="settings-llm-models" value={draft.llm_model} placeholder={cur?.default_model || 'provider default'}
                    onChange={(e) => setDraft({ ...draft, llm_model: e.target.value })}
                    className="h-8 w-60 rounded-md border border-line bg-elevated px-2 font-mono text-[12px] text-fg focus:border-brand focus:outline-none" />
                  <datalist id="settings-llm-models">{modelSuggest.map((m) => <option key={m} value={m} />)}</datalist>
                  <Button size="sm" onClick={testLlm} disabled={!caps.settings.allow_llm}>
                    {ping?.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlugZap className="h-3 w-3" />}Test connection
                  </Button>
                  {ping && !ping.busy && <span className={cn('text-[11px]', ping.ok ? 'text-good' : 'text-bad')}>{ping.ok ? '✓ ' : '✗ '}{ping.detail}</span>}
                </div>
              )}
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button size="sm" variant="primary" disabled={!dirty}
                  onClick={() => commit({ llm_provider: draft.llm_provider, llm_model: draft.llm_model }, `Default LLM saved: ${cur?.label}${draft.llm_model ? ` · ${draft.llm_model}` : ''}.`)}>
                  <Check className="h-3 w-3" />Save as default
                </Button>
                <Button size="sm" onClick={() => { applyLlmToAll(draft.llm_provider, draft.llm_model); setMsg(`All panes now generate with ${cur?.label}${draft.llm_model ? ` · ${draft.llm_model}` : ''}.`) }}>
                  <Sparkles className="h-3 w-3" />Apply to all panes
                </Button>
              </div>
            </Section>

            {/* --- retrieval */}
            <Section icon={<Database className="h-3.5 w-3.5" />} title="Embeddings & vector database"
              hint="Semantic and hybrid panes set to 'default' use these. Each chunk set × model gets its own collection, built automatically on first use.">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-28 text-xs text-muted">Embedding model</span>
                <input list="settings-emb" value={draft.embedding_model} onChange={(e) => setDraft({ ...draft, embedding_model: e.target.value })}
                  className="h-8 w-80 rounded-md border border-line bg-elevated px-2 font-mono text-[12px] text-fg focus:border-brand focus:outline-none" />
                <datalist id="settings-emb">{caps.embedders.map((e) => <option key={e.name} value={e.name} />)}</datalist>
                {(() => {
                  const e = caps.embedders.find((x) => x.name === draft.embedding_model)
                  return e ? <span className={cn('text-[11px]', e.ready ? 'text-good' : 'text-warn')}>{e.ready ? `✓ ${e.detail || 'available'}` : e.detail}</span> : null
                })()}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="w-28 text-xs text-muted">Vector DB</span>
                <Select className="w-60" value={draft.vector_store} onChange={(v) => setDraft({ ...draft, vector_store: v })}
                  options={caps.vector_stores.map((v) => ({ value: v.name, label: v.label, hint: v.ready ? 'connected' : v.detail }))} />
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button size="sm" variant="primary" disabled={!dirty}
                  onClick={() => commit({ embedding_model: draft.embedding_model, vector_store: draft.vector_store }, 'Retrieval defaults saved.')}>
                  <Check className="h-3 w-3" />Save as default
                </Button>
                <Button size="sm" onClick={() => { followDefaults(); setMsg('Semantic and hybrid panes now follow these defaults.') }}>
                  <Sparkles className="h-3 w-3" />Make all panes use these
                </Button>
              </div>
            </Section>

            {/* --- connections */}
            <Section icon={<PlugZap className="h-3.5 w-3.5" />} title="Connections" hint="Live status. Fix anything red by adding the setting to rag-lab/.env and restarting the backend.">
              <div className="overflow-hidden rounded-xl border border-line">
                {caps.vector_stores.map((v) => <ConnRow key={v.name} kind="Vector DB" label={v.label} ok={v.ready} detail={v.ready ? v.detail : `${v.detail}${v.needs ? ` · needs: ${v.needs}` : ''}`} active={v.name === caps.settings.vector_store} />)}
                {llmRows.filter((r) => r.uses_model).map((r) => <ConnRow key={r.name} kind="LLM" label={r.label} ok={r.ready} detail={r.ready ? r.description : r.detail} active={r.name === caps.settings.llm_provider} />)}
              </div>
            </Section>
          </div>
          {msg && <div className="border-t border-line bg-brand/[0.06] px-5 py-2 text-[12px] text-fg">{msg}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Section({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand">{icon}{title}</div>
      {hint && <p className="mb-2.5 text-[11.5px] leading-relaxed text-muted">{hint}</p>}
      {children}
    </section>
  )
}

function PolicyRow({ label, sub, checked, lock, onChange }: { label: string; sub: string; checked: boolean; lock?: string; onChange: (v: boolean) => void }) {
  return (
    <div className="mb-1.5 flex items-center gap-3 rounded-xl border border-line px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-fg">{label}
          {lock && <Tip content={`Locked off by ${lock}. Change it there if your policy allows.`}><Lock className="h-3 w-3 cursor-help text-warn" /></Tip>}
        </div>
        <div className="text-[11px] text-muted">{sub}</div>
      </div>
      <span className={cn('text-[11px] font-medium', checked ? 'text-good' : 'text-warn')}>{checked ? 'allowed' : 'off'}</span>
      <Switch checked={checked} disabled={!!lock} onCheckedChange={onChange} aria-label={label} />
    </div>
  )
}

function ConnRow({ kind, label, ok, detail, active }: { kind: string; label: string; ok: boolean; detail: string; active: boolean }) {
  return (
    <div className="flex items-start gap-2.5 border-b border-line px-3 py-1.5 text-[12px] last:border-b-0">
      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', ok ? 'bg-good' : 'bg-bad/70')} />
      <span className="w-16 shrink-0 text-[10.5px] uppercase tracking-wide text-subtle">{kind}</span>
      <span className="w-40 shrink-0 font-medium text-fg">{label}{active && <span className="ml-1 text-[10px] font-semibold text-brand">DEFAULT</span>}</span>
      <span className="min-w-0 flex-1 break-words text-muted">{detail}</span>
    </div>
  )
}
