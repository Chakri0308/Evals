import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { Capabilities, Category, DocStats, Registry } from '@/lib/types'

export interface Status {
  ollama: { up: boolean; url: string; models: string[] }
  keys: Record<string, boolean>
  mode: { allow_llm: boolean; allow_embeddings: boolean; locks: Record<string, string> }
  defaults: { llm_provider: string; llm_model: string; embedding_model: string; vector_store: string }
  suggest: Record<string, string[]>
}

export const useStatus = () => useQuery({ queryKey: ['status'], queryFn: () => api<Status>('/api/status'), refetchInterval: 15000 })
export const useCapabilities = () => useQuery({ queryKey: ['capabilities'], queryFn: () => api<Capabilities>('/api/capabilities'), refetchInterval: 10000 })
export const useRegistry = () => useQuery({ queryKey: ['components'], queryFn: () => api<Registry>('/api/components'), staleTime: Infinity })
export const useDocs = () => useQuery({ queryKey: ['docs'], queryFn: () => api<DocStats[]>('/api/documents') })
export const useDoc = (id?: string) =>
  useQuery({ queryKey: ['doc', id], enabled: !!id, staleTime: Infinity, queryFn: () => api<DocStats & { text: string; blocks: any[] }>(`/api/documents/${id}`) })
export const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/api/categories'), staleTime: Infinity })

export function useSuggestions(): Record<string, string[]> {
  const { data } = useStatus()
  return { ollama_models: data?.ollama.models ?? [], ...(data?.suggest ?? {}) }
}
