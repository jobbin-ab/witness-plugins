import { statusLabel } from './labels'

/**
 * The page's status ring (`ui/src/glyphs.tsx`) in one terminal cell. Retired keys take the
 * shape of what they meant, as the page draws them. Done and By design share the full
 * cell: a one-cell ring cannot hold a mark inside a fill, and the page says which.
 */
const SHAPE_OF_RETIRED: Readonly<Record<string, string>> = { open: 'investigating', fixed: 'done', inbox: 'triage' }

const CELLS: Readonly<Record<string, string>> = {
  triage: '⊙',
  investigating: '○',
  decision: '◌',
  ready: '◐',
  verify: '◕',
  done: '●',
  byDesign: '●',
  parked: '⊖',
  blocked: '⊗',
  cancelled: '⊘',
}

/**
 * The four statuses that owe someone a move carry the terminal's own ANSI colour, so
 * the person's theme decides the shade; the rest are the default ink.
 */
const TERMINAL_COLOURS: Readonly<Record<string, string>> = {
  decision: 'yellow',
  ready: 'blue',
  verify: 'magenta',
  blocked: 'red',
}

export function shapeOf(status: string): string {
  return SHAPE_OF_RETIRED[status] ?? status
}

export function glyphCell(status: string): string {
  return CELLS[shapeOf(status)] ?? '○'
}

export function glyphColour(status: string): string | undefined {
  return TERMINAL_COLOURS[shapeOf(status)]
}

/**
 * The page's hues (`ui/src/tokens.css`, `ui/src/project.css` `.glyph--*`), dark then light,
 * and the page colour the Done check is cut out of.
 */
const HUES: Readonly<Record<string, readonly [string, string]>> = {
  triage: ['#9b958a', '#8a847a'],
  investigating: ['#9b958a', '#8a847a'],
  decision: ['#dba23f', '#ac710d'],
  ready: ['#6ea6e4', '#24619f'],
  verify: ['#ae8cec', '#6e43be'],
  done: ['#918b81', '#6d685f'],
  byDesign: ['#9b958a', '#8a847a'],
  parked: ['#9b958a', '#8a847a'],
  blocked: ['#e8796d', '#ba392e'],
  cancelled: ['#878581', '#6b6864'],
}
const PAGE: readonly [string, string] = ['#191918', '#fbfbfa']

/** The page's own glyph as an SVG document, 16-unit box, both themes by the reader's scheme. */
export function glyphSvg(status: string): string {
  const shape = shapeOf(status)
  const [dark, light] = HUES[shape] ?? HUES.investigating!
  const style =
    `<style>.g{color:${dark}}.p{stroke:${PAGE[0]}}` +
    `@media (prefers-color-scheme: light){.g{color:${light}}.p{stroke:${PAGE[1]}}}</style>`
  let body: string
  if (shape === 'done' || shape === 'byDesign') {
    const mark =
      shape === 'done'
        ? '<path class="p" d="M4.7 8.3 6.9 10.5 11.3 5.9" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
        : '<path class="p" d="M5.2 8h5.6" stroke-width="1.8" stroke-linecap="round"/>'
    body = `<circle cx="8" cy="8" r="7" fill="currentColor"/>${mark}`
  } else {
    const dash = shape === 'decision' ? ' stroke-dasharray="2.4 2.3"' : shape === 'triage' ? ' stroke-dasharray="1.1 2.4"' : ''
    const ring = `<circle cx="8" cy="8" r="6.1" fill="none" stroke="currentColor" stroke-width="1.7"${dash}/>`
    const inner: Record<string, string> = {
      ready: '<path d="M8 1.8a6.2 6.2 0 0 1 0 12.4z" fill="currentColor"/>',
      verify: '<path d="M8 8V1.8A6.2 6.2 0 1 1 1.8 8z" fill="currentColor"/>',
      parked: '<path d="M5.2 8h5.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
      triage: '<circle cx="8" cy="8" r="1.7" fill="currentColor"/>',
      cancelled: '<path d="M4.6 11.4 11.4 4.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
      blocked: '<path d="M5.8 5.8 10.2 10.2 M10.2 5.8 5.8 10.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    }
    body = ring + (inner[shape] ?? '')
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14">` +
    `<title>${statusLabel(status)}</title>${style}<g class="g">${body}</g></svg>`
  )
}
