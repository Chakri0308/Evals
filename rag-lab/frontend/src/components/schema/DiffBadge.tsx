import { Tip } from '@/components/ui'

export function DiffBadge({ title }: { title: string }) {
  return (
    <Tip content={<span className="whitespace-pre-line">{title}</span>}>
      <span className="inline-flex h-3.5 min-w-3.5 cursor-help items-center justify-center rounded bg-warn/15 px-0.5 font-mono text-[10px] font-bold leading-none text-warn ring-1 ring-warn/40">≠</span>
    </Tip>
  )
}
