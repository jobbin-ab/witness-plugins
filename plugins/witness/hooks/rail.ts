import type { WitnessArtifact, WitnessHeldCard, WitnessPullRequest, WitnessTree } from '../types'
import { isRecord } from './calls'
import { glyphCell } from './glyphs'

/** The pane's id and title, which `/witness` names too. */
export const RAIL = 'witness'
/** The app's rail width in characters at its type size: what the dock asks for. */
export const RAIL_COLUMNS = 44
/** The rows the pane asks for inline: all four sections at their usual size. */
export const RAIL_MAX_ROWS = 14

export const NOT_CONNECTED = 'witness is not connected. Sign in with /mcp.'
/** Two rows, said only when the rail has nothing else to draw. */
export const NO_CARD = ['No card yet.', "The agent's first card appears here."] as const

/** Where a project's page is kept: by server and project id, so two servers that hold the same id never cross-link. */
export function pageKey(server: string, projectId: string): string {
  return `${server}\u0000${projectId}`
}

/** `<page>#/cards/<id>` (`ui/src/router.ts`), with the page `agent_md` named for the card's server and project; undefined before it has. */
export function cardUrl(
  card: Pick<WitnessHeldCard, 'server' | 'projectId' | 'id'>,
  pages: Readonly<Record<string, string>>,
): string | undefined {
  const page = pages[pageKey(card.server, card.projectId)]
  return page ? `${page}#/cards/${encodeURIComponent(card.id)}` : undefined
}

/**
 * The cells one character takes in a monospace terminal: none for a combining mark or a
 * joiner, two for East Asian wide and fullwidth forms and for emoji, else one. The engine
 * offers no measure of its own.
 */
function cellsOf(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0
  if (/^[\p{Mn}\p{Me}\u200b-\u200f\ufe00-\ufe0f]$/u.test(ch)) return 0
  if (/^\p{Extended_Pictographic}$/u.test(ch) && cp > 0x2bff) return 2
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2
  }
  return 1
}

/** The cells a string takes. */
export function cells(text: string): number {
  let n = 0
  for (const ch of text) n += cellsOf(ch)
  return n
}

/** Cuts to `width` cells, `…` the last cell when cut; a wide character never straddles the edge. */
export function cut(text: string, width: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (width <= 0) return ''
  if (cells(flat) <= width) return flat
  let out = ''
  let used = 0
  for (const ch of flat) {
    const w = cellsOf(ch)
    if (used + w > width - 1) break
    out += ch
    used += w
  }
  return `${out}…`
}

/** One row of the rail, as every surface draws it. */
export type RailRow =
  | { kind: 'header'; text: string }
  | { kind: 'gap' }
  | { kind: 'note'; text: string }
  | { kind: 'card'; card: WitnessHeldCard; href?: string }
  | { kind: 'more'; count: number }
  | { kind: 'link'; text: string; href: string; dim?: boolean }
  | { kind: 'about'; text: string }

export type RailFacts = {
  cards: readonly WitnessHeldCard[]
  artifacts: readonly WitnessArtifact[]
  tree: WitnessTree
  /** Per `pageKey`, the project's page address, as `agent_md` named it: the card rows' links. */
  pages: Readonly<Record<string, string>>
  /** Whether a witness server is connected: only the empty state reads it. */
  isConnected: boolean
}

/** How many of CARDS and ARTIFACTS to show before `n more`; absent shows all. */
export type Fold = { cards?: number; artifacts?: number }

/**
 * The rail's rows: PULL REQUEST, CARD or CARDS, ARTIFACT or ARTIFACTS, ABOUT, a section
 * with nothing in it not drawn, one gap between sections. Not connected is said where
 * CARDS would stand, whatever else is drawn; connected with no card yet says so only
 * when there is nothing else to draw.
 */
export function railRows(facts: RailFacts, fold: Fold = {}): RailRow[] {
  const sections: RailRow[][] = []
  const pr = facts.tree.pullRequest
  if (pr) {
    sections.push([
      { kind: 'header', text: 'PULL REQUEST' },
      { kind: 'link', text: pr.title, href: pr.url },
      { kind: 'link', text: `#${pr.number} · ${pr.state}`, href: pr.url, dim: true },
    ])
  }
  const folded = <T,>(list: readonly T[], shown: number | undefined, row: (x: T) => RailRow): RailRow[] =>
    shown === undefined || shown >= list.length
      ? list.map(row)
      : [...list.slice(0, shown).map(row), { kind: 'more', count: list.length - shown }]
  if (facts.cards.length) {
    sections.push([
      { kind: 'header', text: facts.cards.length === 1 ? 'CARD' : 'CARDS' },
      ...folded(facts.cards, fold.cards, (card): RailRow => {
        const href = cardUrl(card, facts.pages)
        return href ? { kind: 'card', card, href } : { kind: 'card', card }
      }),
    ])
  } else if (!facts.isConnected) {
    sections.push([{ kind: 'note', text: NOT_CONNECTED }])
  }
  if (facts.artifacts.length) {
    sections.push([
      { kind: 'header', text: facts.artifacts.length === 1 ? 'ARTIFACT' : 'ARTIFACTS' },
      ...folded(facts.artifacts, fold.artifacts, (a): RailRow => ({ kind: 'link', text: a.title, href: a.url })),
    ])
  }
  const about: RailRow[] = []
  if (facts.tree.branch) about.push({ kind: 'about', text: facts.tree.branch })
  if (facts.tree.repository) {
    about.push({ kind: 'about', text: pr?.base ? `${facts.tree.repository} from ${pr.base}` : facts.tree.repository })
  }
  if (about.length) sections.push([{ kind: 'header', text: 'ABOUT' }, ...about])
  if (sections.length === 0) sections.push(NO_CARD.map((text): RailRow => ({ kind: 'note', text })))
  return sections.flatMap((rows, i) => (i === 0 ? rows : [{ kind: 'gap' } as RailRow, ...rows]))
}

/**
 * The fold that fits `budget` rows: CARDS first, to as many rows as fit (at least one)
 * and `n more`, then ARTIFACTS the same way; PULL REQUEST and ABOUT never fold. A fold
 * that saves no row is not made (hiding one row behind `1 more` saves nothing). What
 * still overflows with both at their floor is returned as it is.
 */
export function fitRows(facts: RailFacts, budget: number): RailRow[] {
  const fold: Fold = {}
  let rows = railRows(facts)
  for (const [key, list] of [
    ['cards', facts.cards],
    ['artifacts', facts.artifacts],
  ] as const) {
    const over = rows.length - budget
    if (over <= 0) break
    const shown = Math.max(1, list.length - 1 - over)
    if (list.length - shown < 2) continue
    fold[key] = shown
    rows = railRows(facts, fold)
  }
  return rows
}

/** The rows the pane asks for inline: its lines with the folds that fit fourteen, which may be more. */
export function inlineRows(facts: RailFacts): number {
  return Math.max(1, fitRows(facts, RAIL_MAX_ROWS).length)
}

/**
 * The cells the engine draws before `hint` on the same row and does not hand over: the
 * mode pill (`⏸ manual mode on · `, `⏵⏵ accept edits on `), seen in a real terminal at
 * 19 cells and in neither `PromptHint`'s `hint` nor `SessionMode`'s `modes`. Reserved
 * whether or not a pill is drawn, so a tail is never cut by one.
 */
export const MODE_PILL_CELLS = 19

/** The cells the engine keeps clear at the row's end: it cuts a hint line at `columns - 3`. */
const ROW_END_CELLS = 3

/**
 * The tail of the dim hint line while cards are held and the rail is not placed:
 * `◕ GN-304 · ○ GN-433`, and ` · /witness` until the rail has been shown once. The
 * engine joins a tail to its own line with ` · ` (seen in a real terminal), so the tail
 * carries no separator of its own. Fitted, never cut: whole parts go from the end,
 * `/witness` first and then the last card, until the two-cell indent, a mode pill, the
 * engine's line, the joining ` · ` and the tail fit the row the engine draws (three cells
 * short of the terminal) with one cell to spare.
 */
export function hintTail(
  cards: readonly WitnessHeldCard[],
  shown: boolean,
  hint = '',
  columns = Number.POSITIVE_INFINITY,
): string | undefined {
  const parts = cards.map((c) => `${glyphCell(c.status)} ${c.id}`)
  if (!shown && parts.length) parts.push('/witness')
  const room = columns - ROW_END_CELLS - 1 - 2 - MODE_PILL_CELLS - cells(hint) - 3
  while (parts.length && cells(parts.join(' · ')) > room) parts.pop()
  return parts.length ? parts.join(' · ') : undefined
}

/**
 * `gh pr view --json number,title,url,state,isDraft,baseRefName`, as a pull request.
 * `state` is gh's `OPEN`, `CLOSED` or `MERGED`; an open draft reads `Draft`.
 */
export function parsePullRequest(stdout: string): WitnessPullRequest | null {
  let v: unknown
  try {
    v = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!isRecord(v) || typeof v.number !== 'number' || typeof v.url !== 'string') return null
  const raw = typeof v.state === 'string' ? v.state.toUpperCase() : ''
  const state =
    raw === 'MERGED' ? 'Merged' : raw === 'CLOSED' ? 'Closed' : v.isDraft === true ? 'Draft' : 'Open'
  return {
    number: v.number,
    title: typeof v.title === 'string' ? v.title : '',
    url: v.url,
    state,
    base: typeof v.baseRefName === 'string' ? v.baseRefName : '',
  }
}

/** Whether a Bash command may have changed the pull request: `gh pr …` or `git push`. */
export function touchesPullRequest(command: string): boolean {
  return /\bgh\s+pr\b/.test(command) || /\bgit\b[^|;&\n]*\spush\b/.test(command)
}

/**
 * The artifact a successful Artifact call published, from its result: a publish (the
 * default action) or a create from a type, never an asset upload, a read or a listing.
 */
export function publishedArtifact(input: Record<string, unknown>, result: unknown): WitnessArtifact | undefined {
  const action = input.action ?? 'publish'
  if (action !== 'publish' || input.asset === true || !isRecord(result)) return undefined
  const url = result.url
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) return undefined
  const path = typeof result.path === 'string' ? result.path : typeof input.file_path === 'string' ? input.file_path : ''
  const title =
    (typeof result.title === 'string' && result.title) ||
    (typeof input.title === 'string' && input.title) ||
    path.split('/').pop() ||
    url
  return { url, title }
}

/** Adds an artifact at the end, or retitles the one at that URL in place. */
export function withArtifact(list: readonly WitnessArtifact[], a: WitnessArtifact): WitnessArtifact[] {
  return list.some((x) => x.url === a.url) ? list.map((x) => (x.url === a.url ? a : x)) : [...list, a]
}
