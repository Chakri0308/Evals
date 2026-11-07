import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { ComponentInfo, JSONSchema, PipelineConfig, Registry, StageName } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function stableStringify(v: any): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}'
}

export function hashConfig(p: PipelineConfig): string {
  const { name: _n, color: _c, id: _i, ...rest } = p
  return stableStringify(rest)
}

export function findComponent(reg: Registry | undefined, stage: StageName, name: string): ComponentInfo | undefined {
  return reg?.stages.find((s) => s.stage === stage)?.components.find((c) => c.name === name)
}

export function schemaDefaults(schema?: JSONSchema): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(schema?.properties ?? {})) if (v.default !== undefined) out[k] = v.default
  return out
}

export function effectiveParams(reg: Registry | undefined, stage: StageName, component: string, params: Record<string, any>) {
  return { ...schemaDefaults(findComponent(reg, stage, component)?.schema), ...params }
}

export const STOP = new Set(
  'a an and are as at be but by for from has have i if in into is it its of on or that the their then there these they this to was were will with what when which who how do does should can you your we our not no me my about'.split(' '),
)

export function queryTerms(q: string): string[] {
  const ts = (q.toLowerCase().match(/[a-z0-9]+(?:['’][a-z]+)?/g) ?? []).filter((t) => !STOP.has(t) && t.length > 1)
  return Array.from(new Set(ts))
}

export const fmtMs = (ms?: number) =>
  ms === undefined || ms === null ? '–' : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`

export const fmtScore = (v?: number) =>
  v === undefined || v === null ? '–' : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3)

export function locationLabel(c: { page?: number | null; heading_path: string[] }) {
  const parts: string[] = []
  if (c.page) parts.push(`p.${c.page}`)
  if (c.heading_path?.length) parts.push(c.heading_path.slice(-2).join(' › '))
  return parts.join(' · ') || 'document'
}

export function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const modKey = isMac ? '⌘' : 'Ctrl'
