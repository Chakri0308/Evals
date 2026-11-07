import { useEffect, useId, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { JSONSchema } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Segmented, Select, Slider, Switch, Tip } from '@/components/ui'
import { DiffBadge } from './DiffBadge'

export interface SchemaFormProps {
  schema?: JSONSchema
  values: Record<string, any>
  explicit?: Record<string, any>
  onChange: (key: string, value: any) => void
  onReset?: (key: string) => void
  diff?: Record<string, string>
  suggestions?: Record<string, string[]>
  dense?: boolean
}

const humanize = (k: string) => k.replace(/_+$/, '').replace(/_/g, ' ').replace(/\bk\b/, 'k').replace(/^./, (c) => c.toUpperCase())

/** Renders controls automatically from a Pydantic JSON Schema. New components need no frontend changes. */
export function SchemaForm({ schema, values, explicit = {}, onChange, onReset, diff = {}, suggestions = {}, dense }: SchemaFormProps) {
  const props = Object.entries(schema?.properties ?? {})
  if (!props.length) return <div className="py-1 text-[11.5px] italic text-subtle">No parameters.</div>
  return (
    <div className={cn('grid gap-x-4', dense ? 'gap-y-2' : 'gap-y-3', 'grid-cols-1 @md:grid-cols-2')}>
      {props.map(([key, s]) => (
        <Field key={key} k={key} s={s} value={values[key]} isSet={key in explicit} onChange={(v) => onChange(key, v)}
          onReset={onReset ? () => onReset(key) : undefined} diff={diff[key]}
          suggest={s['x-suggest'] ? suggestions[s['x-suggest']] : s['x-options'] ? suggestions[s['x-options']] : s.examples} />
      ))}
    </div>
  )
}

function resolve(s: JSONSchema): JSONSchema {
  if (s.anyOf) {
    const nn = s.anyOf.find((x) => x.type !== 'null')
    return { ...nn, ...s, anyOf: undefined }
  }
  return s
}

function Field({ k, s: raw, value, isSet, onChange, onReset, diff, suggest }: {
  k: string; s: JSONSchema; value: any; isSet: boolean; onChange: (v: any) => void; onReset?: () => void; diff?: string; suggest?: string[]
}) {
  const s = resolve(raw)
  const label = s.title && s.title.toLowerCase() !== k.replace(/_/g, ' ') ? s.title : humanize(k)
  const wide = s['x-widget'] === 'textarea'
  const head = (
    <div className="mb-1 flex items-center gap-1.5">
      <Tip content={s.description}><label className="cursor-help truncate text-[11.5px] font-medium text-muted">{label}</label></Tip>
      {diff && <DiffBadge title={diff} />}
      {isSet && onReset && JSON.stringify(value) !== JSON.stringify(s.default) && (
        <button onClick={onReset} title={`Reset to default (${JSON.stringify(s.default)})`} className="text-subtle opacity-60 hover:text-fg hover:opacity-100">
          <RotateCcw className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  )

  let control: React.ReactNode
  if (s['x-options'] && suggest?.length) {
    const opts = suggest.map((o) => ({ value: o, label: o === 'default' ? 'default (⚙ Settings)' : o }))
    control = <Select className="w-full" value={String(value ?? s.default)} options={opts} onChange={onChange} />
  } else if (s.enum) {
    const opts = s.enum.map((e) => ({ value: String(e), label: String(e).replace(/^local:/, '').replace(/^sentence-transformers\//, '') }))
    const short = opts.length <= 4 && opts.every((o) => o.label.length <= 12)
    control = short
      ? <Segmented size="xs" value={String(value)} options={opts} onChange={(v) => onChange(v)} />
      : <Select className="w-full" value={String(value)} options={opts} onChange={onChange} />
  } else if (s.type === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-2 py-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <Tip content={s.description}><span className="cursor-help truncate text-[11.5px] font-medium text-muted">{label}</span></Tip>
          {diff && <DiffBadge title={diff} />}
        </div>
        <Switch size="sm" checked={!!value} onCheckedChange={onChange} aria-label={label} />
      </div>
    )
  } else if ((s.type === 'integer' || s.type === 'number') && s.minimum !== undefined && s.maximum !== undefined) {
    control = <NumberSlider value={value ?? s.default} min={s.minimum} max={s.maximum} int={s.type === 'integer'} onChange={onChange} />
  } else if (s.type === 'integer' || s.type === 'number') {
    control = <NumInput value={value} int={s.type === 'integer'} onChange={onChange} />
  } else if (wide) {
    control = <TextArea value={value ?? ''} onChange={onChange} />
  } else {
    control = <TextInput value={value ?? ''} onChange={onChange} suggest={suggest} />
  }
  return <div className={cn('min-w-0', wide && '@md:col-span-2')}>{head}{control}</div>
}

function NumberSlider({ value, min, max, int, onChange }: { value: number; min: number; max: number; int: boolean; onChange: (v: number) => void }) {
  const range = max - min
  const step = int ? 1 : range <= 1 ? 0.01 : range <= 10 ? 0.05 : 0.5
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  return (
    <div className="flex items-center gap-2">
      <Slider value={local} min={min} max={max} step={step} onChange={(v) => { setLocal(v); onChange(int ? Math.round(v) : +v.toFixed(3)) }} />
      <NumInput value={local} int={int} min={min} max={max} onChange={(v) => { setLocal(v); onChange(v) }} className="w-[58px]" />
    </div>
  )
}

function NumInput({ value, int, min, max, onChange, className }: { value: number; int: boolean; min?: number; max?: number; onChange: (v: number) => void; className?: string }) {
  const [txt, setTxt] = useState(String(value ?? ''))
  useEffect(() => setTxt(String(value ?? '')), [value])
  const commit = () => {
    let v = int ? parseInt(txt, 10) : parseFloat(txt)
    if (Number.isNaN(v)) { setTxt(String(value)); return }
    if (min !== undefined) v = Math.max(min, v)
    if (max !== undefined) v = Math.min(max, v)
    onChange(v)
  }
  return (
    <input value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()}
      className={cn('h-6 rounded-md border border-line bg-elevated px-1.5 text-right font-mono text-[11px] tabular-nums text-fg focus:border-accent/60 focus:outline-none', className)} />
  )
}

function TextInput({ value, onChange, suggest }: { value: string; onChange: (v: string) => void; suggest?: string[] }) {
  const id = useId()
  const [txt, setTxt] = useState(value)
  useEffect(() => setTxt(value), [value])
  return (
    <>
      <input list={suggest?.length ? id : undefined} value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={() => txt !== value && onChange(txt)}
        onKeyDown={(e) => e.key === 'Enter' && onChange(txt)}
        className="h-7 w-full rounded-md border border-line bg-elevated px-2 font-mono text-[11.5px] text-fg focus:border-accent/60 focus:outline-none" />
      {!!suggest?.length && <datalist id={id}>{suggest.map((s) => <option key={s} value={s} />)}</datalist>}
    </>
  )
}

function TextArea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [txt, setTxt] = useState(value)
  useEffect(() => setTxt(value), [value])
  return (
    <textarea value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={() => txt !== value && onChange(txt)} rows={Math.min(10, Math.max(3, txt.split('\n').length))}
      className="w-full resize-y rounded-md border border-line bg-elevated p-2 font-mono text-[11px] leading-relaxed text-fg focus:border-accent/60 focus:outline-none" />
  )
}
