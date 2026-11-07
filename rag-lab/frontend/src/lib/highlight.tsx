import type { ReactNode } from 'react'

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function highlight(text: string, terms: string[], keyBase = ''): ReactNode[] {
  if (!terms.length) return [text]
  const re = new RegExp(`\\b(${terms.map(esc).join('|')})[a-z]{0,3}\\b`, 'gi')
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<mark key={`${keyBase}m${i++}`} className="qt">{m[0]}</mark>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Inline markdown-lite (bold, code) with query-term highlighting. */
function inline(text: string, terms: string[], kb: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(...highlight(text.slice(last, m.index), terms, `${kb}t${i}`))
    const tok = m[0]
    if (tok.startsWith('**')) out.push(<strong key={`${kb}b${i}`} className="font-semibold text-fg">{highlight(tok.slice(2, -2), terms, `${kb}bb${i}`)}</strong>)
    else out.push(<code key={`${kb}c${i}`} className="rounded bg-elevated px-1 py-px font-mono text-[0.9em] text-fg">{highlight(tok.slice(1, -1), terms, `${kb}cc${i}`)}</code>)
    last = m.index + tok.length
    i++
  }
  if (last < text.length) out.push(...highlight(text.slice(last), terms, `${kb}e`))
  return out
}

/** Renders chunk text as clean readable prose: headings, bullet/numbered lists, paragraphs. */
export function Prose({ text, terms }: { text: string; terms: string[] }) {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let para: string[] = []
  const flush = (k: number) => {
    if (para.length) {
      blocks.push(<p key={`p${k}`} className="mb-1.5 last:mb-0">{inline(para.join(' '), terms, `p${k}`)}</p>)
      para = []
    }
  }
  lines.forEach((ln, k) => {
    const t = ln.trim()
    if (!t) return flush(k)
    const h = t.match(/^(#{1,6})\s+(.*)$/)
    const li = t.match(/^([-*•]|\d+[.)])\s+(.*)$/)
    if (h) {
      flush(k)
      blocks.push(<div key={`h${k}`} className="mb-1 mt-1 text-[12px] font-semibold uppercase tracking-wide text-subtle first:mt-0">{h[2]}</div>)
    } else if (li) {
      flush(k)
      blocks.push(
        <div key={`l${k}`} className="mb-1 flex gap-2 pl-1">
          <span className="select-none font-mono text-[11px] leading-[1.6] text-subtle">{/\d/.test(li[1]) ? li[1] : '•'}</span>
          <span>{inline(li[2], terms, `l${k}`)}</span>
        </div>,
      )
    } else para.push(t)
  })
  flush(lines.length)
  return <div className="text-[13px] leading-[1.6] text-fg/90">{blocks}</div>
}
