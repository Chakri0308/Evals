import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { sse } from '@/api/client'
import type { PaneId, PaneRun, PipelineConfig, Registry, RunResult, StageName } from '@/lib/types'
import { PANE_IDS, STAGES } from '@/lib/types'
import { deepClone, findComponent, hashConfig } from '@/lib/utils'

const PANE_META: Record<PaneId, { color: string }> = {
  A: { color: 'indigo' }, B: { color: 'emerald' }, C: { color: 'amber' },
}

/** Settings sync never touches these (they define what each pane is comparing). */
const LOCKED = new Set(['retrieval.component', 'retrieval.enabled', 'fusion.enabled', 'fusion.component'])

export type BottomTab = 'compare' | 'qgen' | 'eval' | 'annotations' | 'document'

interface Focus { pane: PaneId; chunkId: string; nonce: number }

interface State {
  theme: 'dark' | 'light'
  registry?: Registry
  docId?: string
  question: string
  paneCount: 1 | 2 | 3
  panes: Record<PaneId, PipelineConfig>
  runs: Record<PaneId, PaneRun>
  sync: boolean
  autoRun: boolean
  maximized: PaneId | null
  bottomTab: BottomTab
  bottomOpen: boolean
  focus: Focus | null
  docFocus: Focus | null
  openDrawer: Record<PaneId, StageName | null>
  paneTab: Record<PaneId, 'results' | 'trace' | 'prompt'>
  showDropped: boolean
  historyOpen: boolean
  settingsOpen: boolean
  lastHistoryId?: string

  setRegistry: (r: Registry) => void
  setTheme: (t: 'dark' | 'light') => void
  setDoc: (id: string) => void
  setQuestion: (q: string) => void
  setPaneCount: (n: 1 | 2 | 3) => void
  setSync: (v: boolean) => void
  setAutoRun: (v: boolean) => void
  setMaximized: (p: PaneId | null) => void
  setBottom: (t: BottomTab, open?: boolean) => void
  toggleBottom: () => void
  setOpenDrawer: (p: PaneId, s: StageName | null) => void
  setPaneTab: (p: PaneId, t: 'results' | 'trace' | 'prompt') => void
  setShowDropped: (v: boolean) => void
  setHistoryOpen: (v: boolean) => void
  setSettingsOpen: (v: boolean) => void
  /** Point every pane's Generate stage at one provider/model (Settings → "Apply to all panes"). */
  applyLlmToAll: (provider: string, model: string) => void
  /** Make every semantic/hybrid pane follow the Settings embedding model + vector store ('default'). */
  followDefaultRetrieval: () => void

  setStageEnabled: (p: PaneId, s: StageName, v: boolean) => void
  setStageComponent: (p: PaneId, s: StageName, c: string) => void
  setParam: (p: PaneId, s: StageName, key: string, v: any) => void
  resetParam: (p: PaneId, s: StageName, key: string) => void
  setPaneName: (p: PaneId, name: string) => void
  replacePane: (p: PaneId, cfg: PipelineConfig) => void
  duplicatePane: (from: PaneId, to: PaneId) => void
  resetPanes: () => void
  applyChunkingToAll: (cfg: PipelineConfig['stages']['chunking']) => void

  focusChunk: (p: PaneId, chunkId: string) => void
  showInDoc: (p: PaneId, chunkId: string) => void
  runPanes: (ids?: PaneId[], opts?: { saveHistory?: boolean }) => Promise<void>
  loadHistoryRun: (rec: any) => void
}

const emptyRun = (): PaneRun => ({ status: 'idle', token: 0, stages: {}, answer: '' })

function freshPanes(reg?: Registry): Record<PaneId, PipelineConfig> {
  const d = reg?.default_panes ?? []
  const out = {} as Record<PaneId, PipelineConfig>
  PANE_IDS.forEach((id, i) => {
    out[id] = deepClone({ ...(d[i] ?? d[0]), id, color: PANE_META[id].color }) as PipelineConfig
  })
  return out
}

const controllers: Partial<Record<PaneId | 'all', AbortController>> = {}

export const useApp = create<State>()(
  persist(
    (set, get) => {
      /** Apply a mutation to pane p, and to the other visible panes if sync is on (respecting locks). */
      const mutate = (p: PaneId, path: string, fn: (cfg: PipelineConfig, isSource: boolean) => void) => {
        set((st) => {
          const panes = { ...st.panes }
          const targets = st.sync && !LOCKED.has(path) ? PANE_IDS.slice(0, st.paneCount) : [p]
          if (!targets.includes(p)) targets.push(p)
          for (const id of targets) {
            const c = deepClone(panes[id])
            fn(c, id === p)
            panes[id] = c
          }
          return { panes }
        })
      }

      return {
        theme: 'light',
        question: '',
        paneCount: 3,
        panes: freshPanes(),
        runs: { A: emptyRun(), B: emptyRun(), C: emptyRun() },
        sync: false,
        autoRun: false,
        maximized: null,
        bottomTab: 'compare',
        bottomOpen: true,
        focus: null,
        docFocus: null,
        openDrawer: { A: null, B: null, C: null },
        paneTab: { A: 'results', B: 'results', C: 'results' },
        showDropped: false,
        historyOpen: false,
        settingsOpen: false,

        setRegistry: (r) => {
          const st = get()
          // keep persisted panes if they look valid, else seed from defaults
          const valid = PANE_IDS.every((id) => st.panes[id]?.stages && STAGES.every((s) => st.panes[id].stages[s]))
          set({ registry: r, panes: valid ? st.panes : freshPanes(r) })
        },
        setTheme: (t) => set({ theme: t }),
        setDoc: (id) => set({ docId: id, runs: { A: emptyRun(), B: emptyRun(), C: emptyRun() } }),
        setQuestion: (q) => set({ question: q }),
        setPaneCount: (n) => set((st) => ({ paneCount: n, maximized: st.maximized && PANE_IDS.indexOf(st.maximized) >= n ? null : st.maximized })),
        setSync: (v) => set({ sync: v }),
        setAutoRun: (v) => set({ autoRun: v }),
        setMaximized: (p) => set({ maximized: p }),
        setBottom: (t, open = true) => set({ bottomTab: t, bottomOpen: open }),
        toggleBottom: () => set((s) => ({ bottomOpen: !s.bottomOpen })),
        setOpenDrawer: (p, s) => set((st) => ({ openDrawer: { ...st.openDrawer, [p]: s } })),
        setPaneTab: (p, t) => set((st) => ({ paneTab: { ...st.paneTab, [p]: t } })),
        setShowDropped: (v) => set({ showDropped: v }),
        setHistoryOpen: (v) => set({ historyOpen: v }),
        setSettingsOpen: (v) => set({ settingsOpen: v }),
        applyLlmToAll: (provider, model) => set((st) => {
          const panes = deepClone(st.panes)
          for (const id of PANE_IDS) {
            const g = panes[id].stages.generation
            const keep = g.component === provider ? { ...g.params } : {}
            if (model) keep.model = model
            else delete keep.model
            panes[id].stages.generation = { ...g, component: provider, params: keep, enabled: true }
          }
          return { panes }
        }),
        followDefaultRetrieval: () => set((st) => {
          const panes = deepClone(st.panes)
          for (const id of PANE_IDS) {
            const r = panes[id].stages.retrieval
            if (r.component !== 'dense' && r.component !== 'hybrid') continue
            const { embedding_model: _e, vector_store: _v, ...rest } = r.params
            panes[id].stages.retrieval = { ...r, params: rest }
          }
          return { panes }
        }),

        setStageEnabled: (p, s, v) => mutate(p, `${s}.enabled`, (c) => { c.stages[s].enabled = v }),
        setStageComponent: (p, s, comp) => {
          const reg = get().registry
          mutate(p, `${s}.component`, (c) => {
            const old = c.stages[s].params
            const schema = findComponent(reg, s, comp)?.schema
            const keep: Record<string, any> = {}
            // carry over params that exist in the new component's schema (e.g. chunk size between chunkers)
            for (const k of Object.keys(old)) if (schema?.properties?.[k]) keep[k] = old[k]
            c.stages[s] = { ...c.stages[s], component: comp, params: keep, enabled: true }
          })
        },
        setParam: (p, s, key, v) => {
          const src = get().panes[p].stages[s].component
          mutate(p, `${s}.params.${key}`, (c, isSource) => {
            if (!isSource && c.stages[s].component !== src) return
            c.stages[s].params = { ...c.stages[s].params, [key]: v }
          })
        },
        resetParam: (p, s, key) => mutate(p, `${s}.params.${key}`, (c) => {
          const { [key]: _x, ...rest } = c.stages[s].params
          c.stages[s].params = rest
        }),
        setPaneName: (p, name) => set((st) => ({ panes: { ...st.panes, [p]: { ...st.panes[p], name } } })),
        replacePane: (p, cfg) =>
          set((st) => ({ panes: { ...st.panes, [p]: { ...deepClone(cfg), id: p, color: PANE_META[p].color } } })),
        duplicatePane: (from, to) =>
          set((st) => ({
            panes: { ...st.panes, [to]: { ...deepClone(st.panes[from]), id: to, color: PANE_META[to].color, name: `${st.panes[from].name} (copy)` } },
            paneCount: Math.max(st.paneCount, PANE_IDS.indexOf(to) + 1) as 1 | 2 | 3,
          })),
        resetPanes: () => set((st) => ({ panes: freshPanes(st.registry) })),
        applyChunkingToAll: (cfg) =>
          set((st) => {
            const panes = { ...st.panes }
            for (const id of PANE_IDS) panes[id] = { ...panes[id], stages: { ...panes[id].stages, chunking: deepClone(cfg) } }
            return { panes }
          }),

        focusChunk: (p, chunkId) => set((st) => ({
          focus: { pane: p, chunkId, nonce: Date.now() },
          paneTab: { ...st.paneTab, [p]: 'results' },
        })),
        showInDoc: (p, chunkId) => set({ docFocus: { pane: p, chunkId, nonce: Date.now() }, bottomTab: 'document', bottomOpen: true }),

        runPanes: async (ids, opts) => {
          const st = get()
          const visible = PANE_IDS.slice(0, st.paneCount)
          const targets = (ids ?? visible).filter((i) => visible.includes(i))
          if (!st.docId || !st.question.trim() || !targets.length) return
          const all = !ids
          const key = all ? 'all' : targets.length === 1 ? targets[0] : 'all'
          controllers[key]?.abort()
          if (all) for (const t of targets) controllers[t]?.abort()
          const ctrl = new AbortController()
          controllers[key] = ctrl
          const tokens: Partial<Record<PaneId, number>> = {}
          set((s) => {
            const runs = { ...s.runs }
            for (const id of targets) {
              const token = (runs[id]?.token ?? 0) + 1
              tokens[id] = token
              runs[id] = {
                status: 'running', token, answer: '', stages: Object.fromEntries(STAGES.map((sn) => [sn, { stage: sn, status: 'pending' }])),
                configHash: hashConfig(s.panes[id]), question: s.question, startedAt: Date.now(),
              }
            }
            return { runs }
          })
          const upd = (pane: PaneId, fn: (r: PaneRun) => PaneRun) =>
            set((s) => {
              const r = s.runs[pane]
              if (!r || r.token !== tokens[pane]) return {}
              return { runs: { ...s.runs, [pane]: fn(r) } }
            })
          try {
            await sse('/api/run', {
              doc_id: st.docId, question: st.question,
              pipelines: targets.map((t) => st.panes[t]),
              save_history: opts?.saveHistory ?? all,
            }, (ev, d) => {
              const pane = d.pane as PaneId
              if (ev === 'stage_start') upd(pane, (r) => ({ ...r, stages: { ...r.stages, [d.stage]: { stage: d.stage, status: 'running', component: d.component } } }))
              else if (ev === 'stage_end') upd(pane, (r) => ({ ...r, stages: { ...r.stages, [d.stage]: { ...d } } }))
              else if (ev === 'token') upd(pane, (r) => ({ ...r, answer: r.answer + d.text }))
              else if (ev === 'error') upd(pane, (r) => ({ ...r, error: { stage: d.stage, message: d.message } }))
              else if (ev === 'done') upd(pane, (r) => ({ ...r, status: d.error ? 'error' : 'done', result: d as RunResult, answer: d.answer ?? r.answer }))
              else if (ev === 'history') set({ lastHistoryId: d.id })
              else if (ev === 'fatal') {
                for (const t of targets) upd(t, (r) => ({ ...r, status: 'error', error: { stage: 'server', message: d.message } }))
              }
            }, ctrl.signal)
          } catch (e: any) {
            if (e?.name === 'AbortError') return
            for (const t of targets) upd(t, (r) => ({ ...r, status: 'error', error: { stage: 'network', message: String(e?.message ?? e) } }))
          }
        },
        loadHistoryRun: (rec) => {
          const panes = { ...get().panes }
          const runs = { ...get().runs }
          const ids: PaneId[] = []
          for (const p of rec.pipelines as PipelineConfig[]) {
            const id = p.id as PaneId
            ids.push(id)
            panes[id] = { ...p, color: PANE_META[id].color }
            const res = rec.results[id] as RunResult
            runs[id] = {
              status: res?.error ? 'error' : 'done', token: (runs[id]?.token ?? 0) + 1, answer: res?.answer ?? '', result: res,
              error: res?.error, configHash: hashConfig(panes[id]), question: rec.question,
              stages: Object.fromEntries(STAGES.map((s) => [s, {
                stage: s, status: (res?.status?.[s] ?? 'pending') as any, ms: res?.timings?.[s], trace: res?.traces?.[s],
                component: p.stages[s].component,
              }])),
            }
          }
          set({ panes, runs, question: rec.question, docId: rec.doc_id, paneCount: Math.max(1, ids.length) as 1 | 2 | 3, historyOpen: false })
        },
      }
    },
    {
      name: 'rag-lab',
      version: 3,
      migrate: (persisted: any, version) => {
        // v2: semantic panes get the cross-encoder reranker on by default (better on paraphrased questions)
        if (version < 2 && persisted?.panes) {
          for (const cfg of Object.values(persisted.panes) as any[]) {
            if (cfg?.stages?.retrieval?.component === 'dense' && cfg.stages.rerank) {
              cfg.stages.rerank = { ...cfg.stages.rerank, enabled: true, component: 'cross_encoder' }
            }
          }
        }
        // v3: Citi-style light theme becomes the default look (dark = navy variant, still one click away)
        if (version < 3 && persisted) persisted.theme = 'light'
        return persisted
      },
      partialize: (s) => ({
        theme: s.theme, docId: s.docId, question: s.question, paneCount: s.paneCount, panes: s.panes,
        sync: s.sync, autoRun: s.autoRun, bottomTab: s.bottomTab, bottomOpen: s.bottomOpen, showDropped: s.showDropped,
      }),
    },
  ),
)

const VIS: Record<number, PaneId[]> = { 1: ['A'], 2: ['A', 'B'], 3: ['A', 'B', 'C'] }
/** Stable array per pane count (zustand selectors must return cached references). */
export const visiblePanes = (s: State) => VIS[s.paneCount] ?? VIS[3]
