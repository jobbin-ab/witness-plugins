import { isRecord, parse, type WitnessCall } from './calls'

function clean(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

/** The path a `list_cards` call asked `covers` about itself, if it did. */
export function askedCovers(call: WitnessCall): string | undefined {
  if (call.op !== 'list_cards' || typeof call.input.covers !== 'string' || !call.input.covers.trim()) return undefined
  return clean(call.input.covers.trim())
}

/** The path as cards name it: the shortest relative path under any of the roots (the repository's, the session's). */
export function relativeTo(path: string, roots: readonly string[]): string | undefined {
  const file = clean(path)
  let best: string | undefined
  for (const r of roots) {
    const base = clean(r).replace(/\/$/, '')
    if (!file.startsWith(`${base}/`)) continue
    const rel = file.slice(base.length + 1)
    if (best === undefined || rel.length < best.length) best = rel
  }
  return best
}

/** The file a write is about to change, from whichever field its tool names it in. */
export function filePathOf(e: Record<string, unknown>): string | undefined {
  const path = e.file_path ?? e.notebook_path
  return typeof path === 'string' && path ? path : undefined
}

/** The cards a `list_cards` answer lists, each as the note names it: `GN-07 (done · “title”)`, the status as its key. */
export function coveringCards(answer: {
  isError: boolean
  structuredContent?: unknown
  content: readonly { type: string; text?: unknown }[]
}): string[] {
  if (answer.isError) return []
  const body = isRecord(answer.structuredContent)
    ? answer.structuredContent
    : parse(answer.content.map((b) => (b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join(''))
  const listed = body && Array.isArray(body.cards) ? body.cards.filter(isRecord) : []
  return listed.flatMap((c) => {
    if (typeof c.id !== 'string') return []
    const status = typeof c.status === 'string' ? c.status : undefined
    const title = typeof c.title === 'string' && c.title ? ` · “${c.title}”` : ''
    return [status ? `${c.id} (${status}${title})` : c.id]
  })
}

/** `witness: GN-07 (done · “…”) and GN-41 (investigating · “…”) cover src/cart/total.ts.` */
export function note(found: readonly string[], path: string): string | undefined {
  if (found.length === 0) return undefined
  const named = found.length < 2 ? found[0] : `${found.slice(0, -1).join(', ')} and ${found.at(-1)}`
  return `witness: ${named} ${found.length === 1 ? 'covers' : 'cover'} ${path}.`
}
