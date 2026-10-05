import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput, ToolCallResult } from 'claude-code'

import type { WitnessArtifact, WitnessHeldCard, WitnessProof, WitnessRailHistory, WitnessTree } from '../types'
import { WITNESS_TOOL, isRecord, pageLink, parse, payload, witnessCall, type WitnessCall } from './calls'
import { cardsChange } from './cards'
import { askedCovers, coveringCards, filePathOf, note, relativeTo } from './covers'
import { HEADER, NOT_YET, WATCHED, doneWrite, question, refusal, type DoneItem } from './done'
import { glyphCell, glyphColour, glyphSvg } from './glyphs'
import { statusLabel } from './labels'
import {
  RAIL,
  RAIL_COLUMNS,
  cells,
  cut,
  fitRows,
  hintTail,
  inlineRows,
  parsePullRequest,
  publishedArtifact,
  pageKey,
  touchesPullRequest,
  withArtifact,
  type RailFacts,
  type RailRow,
} from './rail'

/**
 * The witness mod (docs/mod-concept.md): a Done in a person's name passes through the
 * person's hand; a file a card covers is named before it is changed; and the session has
 * the Mac app's rail, as a pane. It carries no sentence of the method: that is the
 * project document's, read through the MCP tools.
 *
 * Everything that touches `$` is in this file: the engine follows `$` into a function
 * declared here and never across an import, so the other files are plain logic.
 */

const cards = atom({ plugin: 'witness', key: 'cards' } as const, [] as WitnessHeldCard[])
const proofs = atom({ plugin: 'witness', key: 'proofs' } as const, {} as Record<string, WitnessProof>)
const pages = atom({ plugin: 'witness', key: 'pages' } as const, {} as Record<string, string>)
const asked = atom({ plugin: 'witness', key: 'asked' } as const, [] as string[])
const artifacts = atom({ plugin: 'witness', key: 'artifacts' } as const, [] as WitnessArtifact[])
const tree = atom({ plugin: 'witness', key: 'tree' } as const, {
  branch: null,
  repository: null,
  pullRequest: null,
} as WitnessTree)
const rail = atom({ plugin: 'witness', key: 'rail' } as const, {
  shown: false,
  autoOpened: false,
  closedByPerson: false,
} as WitnessRailHistory)

/**
 * Whether the terminal draws the fullscreen layout, learnt from its own hint line (the
 * engine says it on a render's viewport and on a command, nowhere else). Still unknown at
 * the first card, the rail does not open unasked and the hint tail stands in.
 */
let fullscreen: boolean | undefined

/** A connected witness, once seen: tools do not disconnect often enough to ask again per draw. */
let connected = false

/** Where the rail was last drawn, so a change while it sits inline can ask for its new height. */
let placement: 'dock' | 'inline' | undefined

/**
 * Asks the person in the engine's own question dialog. Undefined lets the call through;
 * a string is the refusal. Nobody to ask (a `-p` run, an SDK host with no surface, a Mac
 * app session whose form the question does not reach): the ask rejects and the call
 * passes unchanged, so the server's own guard stands and the mod is never stricter than
 * witness without it. A person there who closes the dialog, or types something else
 * under Other, has not said yes.
 */
async function askDone($: EngineInterface, call: WitnessCall, items: DoneItem[]): Promise<string | undefined> {
  const surfaces = await $.session.surfaces().catch(() => [])
  let answer: string
  try {
    answer = await $.ui.ask(question(call, items), { options: [WATCHED, NOT_YET], header: HEADER })
  } catch {
    return surfaces.length === 0 ? undefined : refusal(call, items, false)
  }
  if (answer === WATCHED) return undefined
  return refusal(call, items, answer === NOT_YET)
}

/** Keeps what an answered witness call says: the project's proof, a `covers` asked, the cards. */
async function recordCall($: EngineInterface, call: WitnessCall, answer: Record<string, unknown>): Promise<void> {
  const projectId = typeof call.input.projectId === 'string' ? call.input.projectId : ''
  const readProof = call.input.readProof
  if (projectId && typeof readProof === 'string') {
    await update($, proofs, (all) => ({ ...all, [projectId]: { server: call.server, readProof } }))
  }
  const path = askedCovers(call)
  if (path) await update($, asked, (list) => (list.includes(path) ? list : [...list, path]))
  connected = true
  const change = cardsChange(call, answer)
  if (!change) return
  const before = (await read($, cards)).length
  const after = (await update($, cards, change)).length
  if (before === 0 && after > 0) await autoOpen($)
  else await growInline($)
  if (projectId && after > 0) await learnPage($, call.server, projectId)
}

/** Keeps a project's page address under its server. The rail reads it while drawing, so a card already held gains its link when it lands. */
async function keepPage($: EngineInterface, server: string, projectId: string, page: string): Promise<void> {
  const key = pageKey(server, projectId)
  await update($, pages, (all) => (all[key] === page ? all : { ...all, [key]: page }))
}

/** The page address the model's own `agent_md` call was answered with, in whatever shape the engine hands it on. */
async function recordPage($: EngineInterface, call: WitnessCall, ran: ToolCallResult): Promise<void> {
  if (ran.deny !== undefined || ran.isError) return
  const projectId = typeof call.input.projectId === 'string' ? call.input.projectId : ''
  const page = pageLink(ran.result, projectId, ran.text)
  if (page) await keepPage($, call.server, projectId, page)
}

/** How long a card write waits on the mod's own `agent_md` before it goes on without a link. */
const PAGE_WAIT_MS = 2000

/** Server and project pairs whose page the mod has asked for itself: once each per session. */
const pagesAsked = new Set<string>()

/**
 * A session that writes with a proof but never called `agent_md` itself (one resumed, or
 * past a compaction) has no page for the project: once per server and project, the mod
 * calls `agent_md` on the server the proof was taken by, and keeps the page it names.
 * `$.mcp.call` is seen by `mcp.call` hooks, never by this mod's `tool.call` hook, so the
 * page is kept here rather than by `recordPage`. Silent on failure and after two seconds,
 * as `coversNote` is.
 */
async function learnPage($: EngineInterface, server: string, projectId: string): Promise<void> {
  const key = pageKey(server, projectId)
  if (pagesAsked.has(key) || (await read($, pages))[key]) return
  const proof = (await read($, proofs))[projectId]
  if (!proof || proof.server !== server) return
  pagesAsked.add(key)
  const stop = new AbortController()
  const timeout = $.clock.sleep(PAGE_WAIT_MS, { signal: stop.signal }).then(
    () => undefined,
    () => undefined,
  )
  const lookup = $.mcp
    .call(server, 'witness_agent_md', { projectId })
    .then((answer) => pageLink(answer, projectId))
    .catch(() => undefined)
  const page = await Promise.race([lookup, timeout])
  stop.abort()
  if (page) await keepPage($, server, projectId, page)
}

async function isConnected($: EngineInterface): Promise<boolean> {
  if (connected) return true
  const tools = await $.tool.list().catch(() => [])
  connected = tools.some((t) => WITNESS_TOOL.test(t.name))
  return connected
}

/** What the rail draws from; read while drawing, so a later write draws it again. */
async function railFacts($: EngineInterface): Promise<RailFacts> {
  const held = await read($, cards)
  return {
    cards: held,
    artifacts: await read($, artifacts),
    tree: await read($, tree),
    pages: await read($, pages),
    isConnected: held.length > 0 || (await isConnected($)),
  }
}

/** Opens the rail: docked 44 columns wide, inline as tall as its lines with the folds that fit fourteen. */
async function openRail($: EngineInterface): Promise<void> {
  const opened = await $.ui.open({ id: RAIL, title: RAIL, columns: RAIL_COLUMNS, rows: inlineRows(await railFacts($)) })
  if (opened.isPlaced) await update($, rail, (h) => ({ ...h, shown: true }))
  // The hint tail reads whether the rail is placed, which no state write announces.
  $.ui.invalidate('ui.render')
}

/**
 * The one unasked open of a session, at its first card. Only where the pane docks beside
 * the transcript (the terminal's fullscreen layout, desktop, VS Code); never with no
 * surface; never after the person closed it. A terminal whose layout is not yet known
 * gets the hint tail instead.
 */
async function autoOpen($: EngineInterface): Promise<void> {
  const history = await read($, rail)
  if (history.autoOpened || history.closedByPerson) return
  const surfaces: readonly string[] = await $.session.surfaces().catch(() => [])
  if (surfaces.length === 0) return
  if (!(surfaces.some((s) => s === 'desktop' || s === 'vscode') || fullscreen === true)) return
  await update($, rail, (h) => ({ ...h, autoOpened: true }))
  await openRail($)
}

/**
 * While the rail sits inline, a card or an artifact that arrives asks the engine for the
 * new height with another open of the same id; the engine may grow the pane or not.
 */
async function growInline($: EngineInterface): Promise<void> {
  if (placement !== 'inline') return
  if (!(await $.ui.panes().catch(() => [])).some((p) => p.id === RAIL)) return
  await $.ui.open({ id: RAIL, title: RAIL, columns: RAIL_COLUMNS, rows: inlineRows(await railFacts($)) })
}

/**
 * The working tree, read at session start, after a Bash call that may have moved the
 * pull request, and at each `/witness`; never polled. No git, no `gh`, no pull request,
 * or an error: that part is absent.
 */
async function refreshTree($: EngineInterface): Promise<void> {
  // No surface (\`-p\`, an SDK host, a Mac app session): nothing draws the rail, so no gh, no git.
  if ((await $.session.surfaces().catch(() => [])).length === 0) return
  const repo = await $.session.repo().catch(() => null)
  let branch: string | null = null
  try {
    const ran = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 10_000 })
    // A detached head reads `HEAD`: no branch.
    if (ran.exitCode === 0 && ran.stdout.trim() && ran.stdout.trim() !== 'HEAD') branch = ran.stdout.trim()
  } catch {
    // No git: no branch.
  }
  let pullRequest = null
  try {
    const ran = await $.process.run(['gh', 'pr', 'view', '--json', 'number,title,url,state,isDraft,baseRefName'], {
      timeoutMs: 15_000,
    })
    if (ran.exitCode === 0) pullRequest = parsePullRequest(ran.stdout)
  } catch {
    // No gh: no pull request.
  }
  const repository = repo ? (repo.root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? null) : null
  await update($, tree, () => ({ branch, repository, pullRequest }))
}

/** How long the edit's result waits on a `covers` answer before it goes without a note. */
const COVERS_WAIT_MS = 2000

/**
 * The note for one file, or undefined: once per path per session, on each project the
 * session has read with a proof, never for a path the agent asked `covers` about itself.
 * Nothing covers it, no answer within two seconds, or anything fails: undefined.
 */
async function coversNote($: EngineInterface, filePath: string): Promise<string | undefined> {
  const known = await read($, proofs)
  const projects = Object.keys(known)
  if (projects.length === 0) return undefined

  const repo = await $.session.repo().catch(() => null)
  const root = await $.session.root().catch(() => undefined)
  const path = relativeTo(filePath, [...(repo ? [repo.root] : []), ...(root ? [root] : [])])
  if (!path) return undefined

  let first = false
  await update($, asked, (list) => {
    first = !list.includes(path)
    return first ? [...list, path] : list
  })
  if (!first) return undefined

  const stop = new AbortController()
  const timeout = $.clock.sleep(COVERS_WAIT_MS, { signal: stop.signal }).then(
    () => [] as string[],
    () => [] as string[],
  )
  const lookup = Promise.all(
    projects.map(async (projectId) => {
      const proof = known[projectId]!
      try {
        const answer = await $.mcp.call(proof.server, 'witness_list_cards', {
          projectId,
          readProof: proof.readProof,
          covers: path,
        })
        return coveringCards(answer)
      } catch {
        // Not connected, or the server failed: silent, the edit runs.
        return []
      }
    }),
  ).then((each) => each.flat())
  const found = await Promise.race([lookup, timeout])
  stop.abort()
  return note(found, path)
}

/**
 * The rail's tree on one surface: every row one line, two cells in under its header, cut
 * with `…` at the body's width. The glyph is a terminal cell on the terminal and the
 * phone, and the page's own SVG on desktop and VS Code.
 */
function drawRail($: EngineInterface, e: RenderInput<'Pane'>, rows: readonly RailRow[]) {
  const { Box, Text, Link } = $.ui.resolve(e)
  const Svg = e.surface === 'desktop' || e.surface === 'vscode' ? $.ui.resolve(e).Svg : undefined
  // Docked, the mod draws the frame's gutter: one cell on the left, one under the close
  // mark, so a header never touches the divider and the \`…\` sits under the \`✕\`.
  const docked = e.props.placement === 'dock'
  const body = (e.props.bodyColumns || RAIL_COLUMNS) - (docked ? 2 : 0)
  const width = Math.max(8, body - 2)
  const line = (row: RailRow) => {
    switch (row.kind) {
      case 'header':
        return <Text dimColor>{row.text}</Text>
      case 'gap':
        return <Text> </Text>
      case 'note':
        // A cause cut short says nothing: a note wraps rather than lose its end.
        return <Text dimColor>{row.text}</Text>
      case 'more':
        return (
          <Box paddingLeft={2}>
            <Text dimColor>{`${row.count} more`}</Text>
          </Box>
        )
      case 'about':
        return (
          <Box paddingLeft={2}>
            <Text dimColor>{cut(row.text, width)}</Text>
          </Box>
        )
      case 'link':
        return (
          <Box paddingLeft={2}>
            <Text dimColor={row.dim === true}>
              <Link href={row.href}>{cut(row.text, width)}</Link>
            </Text>
          </Box>
        )
      case 'card': {
        const { card } = row
        const title = cut(card.title, width - cells(card.id) - 3)
        const words = row.href ? (
          <Text>
            <Link href={row.href}>
              <Text dimColor>{card.id}</Text>
              {title ? ` ${title}` : ''}
            </Link>
          </Text>
        ) : (
          <Text>
            <Text dimColor>{card.id}</Text>
            {title ? ` ${title}` : ''}
          </Text>
        )
        const colour = glyphColour(card.status)
        const glyph = Svg ? (
          <Svg source={glyphSvg(card.status)} alt={statusLabel(card.status)} width={14} height={14} />
        ) : colour ? (
          <Text color={colour}>{glyphCell(card.status)}</Text>
        ) : (
          <Text>{glyphCell(card.status)}</Text>
        )
        return (
          <Box paddingLeft={2} flexDirection="row">
            {glyph}
            <Text> </Text>
            {words}
          </Box>
        )
      }
    }
  }
  return (
    <Box flexDirection="column" paddingLeft={docked ? 1 : 0}>
      {rows.map(line)}
    </Box>
  )
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'witness',
      description: "Shows or hides this session's witness rail: its pull request, cards, artifacts and branch.",
      immediate: true,
    })
    const started = await next(e)
    void refreshTree($).catch(() => {})
    return started
  })

  /** `/witness` opens the rail at any width, docked or inline as the screen allows, and closes it when open. */
  on('command.run', { command: 'witness' }, async ($, e) => {
    fullscreen = e.presentation.isFullscreen
    const open = (await $.ui.panes().catch(() => [])).some((p) => p.id === RAIL)
    if (open) {
      await $.ui.close({ id: RAIL })
      return {}
    }
    // Open from what is held, at once; the tree is read after, and the rail redraws when
    // it lands. gh can take many seconds, and a command waits on nothing it does not need.
    await openRail($)
    void refreshTree($).catch(() => {})
    return {}
  })

  /** A rail the person closed stays closed: nothing reopens it unasked. */
  on('ui.close', { id: RAIL }, async ($, e, next) => {
    const closed = await next(e)
    if (e.origin.kind === 'person') await update($, rail, (h) => ({ ...h, closedByPerson: true }))
    $.ui.invalidate('ui.render')
    return closed
  })

  on('ui.render', { component: 'Pane', requestId: 'witness' }, async ($, e) => {
    placement = e.props.placement
    const facts = await railFacts($)
    // Docked, nothing folds: the column scrolls. Inline, the rows are what the engine gave.
    return drawRail($, e, fitRows(facts, e.props.placement === 'inline' ? e.props.scroll.bodyRows : Number.POSITIVE_INFINITY))
  })

  /**
   * The hint tail: on the terminal, while cards are held and the rail is not placed, the
   * dim line under the prompt ends with each card's glyph and id.
   */
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    if (e.viewport?.isFullscreen !== undefined) fullscreen = e.viewport.isFullscreen
    const held = await read($, cards)
    if (held.length === 0) return next(e)
    const placed = (await $.ui.panes().catch(() => [])).some((p) => p.id === RAIL && p.isPlaced)
    if (placed) return next(e)
    const tail = hintTail(held, (await read($, rail)).shown, e.props.hint, e.viewport?.columns)
    return tail ? next({ ...e, props: { ...e.props, tail } }) : next(e)
  })

  on('tool.call', { tool: /^mcp__.+__witness_[a-z_]+$/ }, async ($, e, next) => {
    const call = witnessCall(e as { tool: string } & Record<string, unknown>)
    if (!call) return next(e)

    const items = doneWrite(call)
    if (items) {
      const refused = await askDone($, call, items)
      if (refused !== undefined) return { deny: refused }
    }

    const ran = await next(e)
    if (call.op === 'agent_md') await recordPage($, call, ran).catch(() => {})
    const answer = payload(ran)
    if (answer) await recordCall($, call, answer).catch(() => {})
    return ran
  })

  /** A Bash call that may have opened, pushed or changed the pull request reads the tree again. */
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (touchesPullRequest(e.command)) void refreshTree($).catch(() => {})
    return ran
  })

  /** An artifact this session published joins the rail. */
  on('tool.call', { tool: /^Artifact$/ }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran
    const result = isRecord(ran.result) ? ran.result : parse(ran.text)
    const published = publishedArtifact(e as Record<string, unknown>, result)
    if (published) {
      await update($, artifacts, (list) => withArtifact(list, published)).catch(() => {})
      await growInline($).catch(() => {})
    }
    return ran
  })

  /**
   * The covers note rides on the edit's own result, as `context`: the text the model reads
   * right after that result. The lookup starts before the edit runs and never holds it back.
   */
  on('tool.call', { tool: /^(Edit|Write|MultiEdit|NotebookEdit)$/ }, async ($, e, next) => {
    const path = filePathOf(e as Record<string, unknown>)
    const pending = path ? coversNote($, path).catch(() => undefined) : Promise.resolve(undefined)
    const ran = await next(e)
    const text = await pending
    if (!text || ran.deny !== undefined) return ran
    return { ...ran, context: [...(ran.context ?? []), text] }
  })
}
