import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { PipelineConfig, Registry } from '@/lib/types'
import { effectiveParams } from '@/lib/utils'

export interface PromptVersion {
  id: string
  name: string
  note: string
  component: string
  params: Record<string, any>
  created: number
  updated: number
}

export function usePromptVersions() {
  return useQuery({ queryKey: ['prompts'], queryFn: () => api<PromptVersion[]>('/api/prompts') })
}

const sorted = (o: Record<string, any>) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]))

/** The saved version whose prompt matches this pipeline's Prompt stage exactly (defaults filled in), if any. */
export function matchingVersion(reg: Registry | undefined, cfg: PipelineConfig, versions: PromptVersion[] | undefined) {
  const sc = cfg.stages.prompt
  const cur = sorted(effectiveParams(reg, 'prompt', sc.component, sc.params))
  return versions?.find((v) => v.component === sc.component && sorted(effectiveParams(reg, 'prompt', v.component, v.params)) === cur)
}

/** A copy of `cfg` whose Prompt stage uses version `v`. */
export function withPrompt(cfg: PipelineConfig, v: PromptVersion): PipelineConfig {
  const c: PipelineConfig = structuredClone(cfg)
  c.stages.prompt = { ...c.stages.prompt, enabled: true, component: v.component, params: structuredClone(v.params) }
  return c
}
