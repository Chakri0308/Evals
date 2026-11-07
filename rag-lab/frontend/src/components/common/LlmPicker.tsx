import { useCapabilities, useStatus } from '@/api/hooks'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui'

export interface LlmChoice { provider: string; model: string }

/** Provider + model picker used by the question generator and the LLM judge. 'default' follows ⚙ Settings. */
export function LlmPicker({ value, onChange, compact }: { value: LlmChoice; onChange: (v: LlmChoice) => void; compact?: boolean }) {
  const { data: caps } = useCapabilities()
  const { data: status } = useStatus()
  const rows = (caps?.llms ?? []).filter((r) => r.uses_model)
  const prov = value.provider === 'default' ? caps?.settings.llm_provider ?? 'ollama' : value.provider
  const row = rows.find((r) => r.name === prov)
  const suggestions = prov === 'ollama' ? status?.ollama.models ?? [] : row?.examples ?? []
  const listId = `llm-models-${compact ? 'c' : 'f'}`
  const dot = (ok: boolean) => <span className={cn('inline-block h-1.5 w-1.5 rounded-full', ok ? 'bg-good' : 'bg-subtle/60')} />
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="w-12 shrink-0">LLM</span>
        <Select className="flex-1" value={value.provider} onChange={(v) => onChange({ provider: v, model: '' })}
          options={[
            { value: 'default', label: `Default (${caps?.settings.llm_provider ?? '…'})`, hint: 'Follows ⚙ Settings' },
            ...rows.map((r) => ({ value: r.name, label: r.label, hint: r.ready ? 'ready' : r.detail })),
          ]} />
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="w-12 shrink-0">Model</span>
        <input list={listId} value={value.model} placeholder={value.provider === 'default' && caps?.settings.llm_model ? caps.settings.llm_model : row?.default_model || 'provider default'}
          onChange={(e) => onChange({ ...value, model: e.target.value })}
          className="h-7 min-w-0 flex-1 rounded-md border border-line bg-elevated px-2 font-mono text-[11.5px] text-fg focus:border-accent/60 focus:outline-none" />
        <datalist id={listId}>{suggestions.map((m) => <option key={m} value={m} />)}</datalist>
      </div>
      {row && (
        <div className="flex items-start gap-1.5 text-[10.5px] leading-snug text-subtle">
          <span className="mt-[5px]">{dot(row.ready)}</span>
          <span>{row.ready ? `${row.label} is ready.` : `${row.detail} The heuristic fallback will be used.`}</span>
        </div>
      )}
    </div>
  )
}
