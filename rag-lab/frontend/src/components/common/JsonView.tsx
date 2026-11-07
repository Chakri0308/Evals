import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Collapsible JSON tree. */
export function JsonView({ data, depth = 0, name, defaultOpen = 1 }: { data: any; depth?: number; name?: string; defaultOpen?: number }) {
  const [open, setOpen] = useState(depth < defaultOpen)
  const isObj = data !== null && typeof data === 'object'
  const label = name !== undefined ? <span className="text-accent/90">{name}: </span> : null
  if (!isObj) {
    const cls = typeof data === 'string' ? 'text-good' : typeof data === 'number' ? 'text-warn' : 'text-subtle'
    const s = typeof data === 'string' ? JSON.stringify(data.length > 400 ? data.slice(0, 400) + '…' : data) : String(data)
    return <div className="break-words pl-3">{label}<span className={cls}>{s}</span></div>
  }
  const entries = Array.isArray(data) ? data.map((v, i) => [String(i), v] as const) : Object.entries(data)
  const summary = Array.isArray(data) ? `[${data.length}]` : `{${entries.length}}`
  return (
    <div className={cn(depth > 0 && 'pl-3')}>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-0.5 text-left hover:text-fg">
        <ChevronRight className={cn('h-3 w-3 text-subtle transition-transform', open && 'rotate-90')} />
        {label}<span className="text-subtle">{summary}</span>
      </button>
      {open && (
        <div className="border-l border-line/70 pl-1">
          {entries.slice(0, 200).map(([k, v]) => <JsonView key={k} name={k} data={v} depth={depth + 1} defaultOpen={defaultOpen} />)}
          {entries.length > 200 && <div className="pl-3 text-subtle">… {entries.length - 200} more</div>}
        </div>
      )}
    </div>
  )
}

export function JsonBlock({ data, className }: { data: any; className?: string }) {
  return <div className={cn('font-mono text-[11px] leading-[1.55] text-muted', className)}><JsonView data={data} /></div>
}
