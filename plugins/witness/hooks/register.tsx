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
 * Everything that touches `$` is in this file, written so a reader of the source can
 * follow it: every use is a literal `$.noun.method(...)`, every registration its own
 * `on("event", ...)` line, and `$` is passed only whole, to a function declared at the
 * top of this file; never into an import (the state library's `read` and `update`
 * included), a nested function, a variable or a destructuring. The other files are
 * plain logic.
 */

const cards = { plugin: 'witness', key: 'cards' } as const
const proofs = { plugin: 'witness', key: 'proofs' } as const
const pages = { plugin: 'witness', key: 'pages' } as const
const asked = { plugin: 'witness', key: 'asked' } as const
const artifacts = { plugin: 'witness', key: 'artifacts' } as const
const tree = { plugin: 'witness', key: 'tree' } as const
const rail = { plugin: 'witness', key: 'rail' } as const

const NO_TREE: WitnessTree = { branch: null, repository: null, pullRequest: null }
const NO_HISTORY: WitnessRailHistory = { shown: false, autoOpened: false, closedByPerson: false }

/**
 * How often a change is tried against a value another write keeps beating, as the state
 * library's `update` bounds it. Each change below reads, applies, and writes with
 * `ifVersion`, again on a miss, so two changes in flight both land.
 */
const TRIES = 64
const BEATEN = 'witness: the value was written by another every time it was read; nothing was written'

async function heldCards($: EngineInterface): Promise<WitnessHeldCard[]> {
  return (await $.state.get(cards)).value ?? []
}

async function changeCards($: EngineInterface, change: (list: WitnessHeldCard[]) => WitnessHeldCard[]): Promise<WitnessHeldCard[]> {
  for (let i = 0; i < TRIES; i += 1) {
    const held = await $.state.get(cards)
    const value = change(held.value ?? [])
    if ((await $.state.set(cards, value, { ifVersion: held.version })).isSet) return value
  }
  throw new Error(BEATEN)
}

async function heldProofs($: EngineInterface): Promise<Record<string, WitnessProof>> {
  return (await $.state.get(proofs)).value ?? {}
}

async function changeProofs(
  $: EngineInterface,
  change: (all: Record<string, WitnessProof>) => Record<string, WitnessProof>,
): Promise<void> {
  for (let i = 0; i < TRIES; i += 1) {
    const held = await $.state.get(proofs)
    if ((await $.state.set(proofs, change(held.value ?? {}), { ifVersion: held.version })).isSet) return
  }
  throw new Error(BEATEN)
}

async function heldPages($: EngineInterface): Promise<Record<string, string>> {
  return (await $.state.get(pages)).value ?? {}
}

async function changePages($: EngineInterface, change: (all: Record<string, string>) => Record<string, string>): Promise<void> {
  for (let i = 0; i < TRIES; i += 1) {
    const held = await $.state.get(pages)
    if ((await $.state.set(pages, change(held.value ?? {}), { ifVersion: held.version })).isSet) return
  }
  throw new Error(BEATEN)
}

async function changeAsked($: EngineInterface, change: (list: string[]) => string[]): Promise<void> {
  for (let i = 0; i < TRIES; i += 1) {
    const held = await $.state.get(asked)
    if ((await $.state.set(asked, change(held.value ?? []), { ifVersion: held.version })).isSet) return
  }
  throw new Error(BEATEN)
}

async function heldArtifacts($: EngineInterface): Promise<WitnessArtifact[]> {
  return (await $.state.get(artifacts)).value ?? []
}

async function changeArtifacts($: EngineInterface, change: (list: WitnessArtifact[]) => WitnessArtifact[]): Promise<void> {
  for (let i = 0; i < TRIES; i += 1) {
    const held = await $.state.get(artifacts)
    if ((await $.state.set(artifacts, change(held.value ?? []), { ifVersion: held.version })).isSet) return
  }
  throw new Error(BEATEN)
}

async function heldTree($: EngineInterface): Promise<WitnessTree> {
  return (await $.state.get(tree)).value ?? NO_TREE
}

async function keepTree($: EngineInterface, value: WitnessTree): Promise<void> {
  await $.state.set(tree, value)
}

async function railHistory($: EngineInterface): Promise<WitnessRailHistory> {
  return (await $.state.get(rail)).value ?? NO_HISTORY
}

async function changeRail($: EngineInterface, change: (h: WitnessRailHistory) => WitnessRailHistory): Promise<void> {
  for (let i = 0; i < TRIES; i += 1) {
    const held = await $.state.get(rail)
    if ((await $.state.set(rail, change(held.value ?? NO_HISTORY), { ifVersion: held.version })).isSet) return
  }
  throw new Error(BEATEN)
}

/** Where the session draws; none on error. */
async function surfaces($: EngineInterface): Promise<readonly string[]> {
  try {
    return await $.session.surfaces()
  } catch {
    return []
  }
}

/** Whether the rail is open; `placed` asks that it is also seated. */
async function railOpen($: EngineInterface, placed: boolean): Promise<boolean> {
  try {
    return (await $.ui.panes()).some((p) => p.id === RAIL && (!placed || p.isPlaced))
  } catch {
    return false
  }
}

/** Resolves undefined after `ms`, or at once when `signal` aborts: the bound a lookup races. */
async function waitFor($: EngineInterface, ms: number, signal: AbortSignal): Promise<undefined> {
  try {
    await $.clock.sleep(ms, { signal })
  } catch {
    // Aborted: the lookup answered first.
  }
  return undefined
}

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
  const where = await surfaces($)
  let answer: string
  try {
    answer = await $.ui.ask(question(call, items), { options: [WATCHED, NOT_YET], header: HEADER })
  } catch {
    return where.length === 0 ? undefined : refusal(call, items, false)
  }
  if (answer === WATCHED) return undefined
  return refusal(call, items, answer === NOT_YET)
}

/** Keeps what an answered witness call says: the project's proof, a `covers` asked, the cards. */
async function recordCall($: EngineInterface, call: WitnessCall, answer: Record<string, unknown>): Promise<void> {
  const projectId = typeof call.input.projectId === 'string' ? call.input.projectId : ''
  const readProof = call.input.readProof
  if (projectId && typeof readProof === 'string') {
    await changeProofs($, (all) => ({ ...all, [projectId]: { server: call.server, readProof } }))
  }
  const path = askedCovers(call)
  if (path) await changeAsked($, (list) => (list.includes(path) ? list : [...list, path]))
  connected = true
  const change = cardsChange(call, answer)
  if (!change) return
  const before = (await heldCards($)).length
  const after = (await changeCards($, change)).length
  if (before === 0 && after > 0) await autoOpen($)
  else await growInline($)
  if (projectId && after > 0) await learnPage($, call.server, projectId)
}

/** Keeps a project's page address under its server. The rail reads it while drawing, so a card already held gains its link when it lands. */
async function keepPage($: EngineInterface, server: string, projectId: string, page: string): Promise<void> {
  const key = pageKey(server, projectId)
  await changePages($, (all) => (all[key] === page ? all : { ...all, [key]: page }))
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

/** The page `agent_md` names for one project on one server; undefined on any failure. */
async function askPage($: EngineInterface, server: string, projectId: string): Promise<string | undefined> {
  try {
    return pageLink(await $.mcp.call(server, 'witness_agent_md', { projectId }), projectId)
  } catch {
    return undefined
  }
}

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
  if (pagesAsked.has(key) || (await heldPages($))[key]) return
  const proof = (await heldProofs($))[projectId]
  if (!proof || proof.server !== server) return
  pagesAsked.add(key)
  const stop = new AbortController()
  const page = await Promise.race([askPage($, server, projectId), waitFor($, PAGE_WAIT_MS, stop.signal)])
  stop.abort()
  if (page) await keepPage($, server, projectId, page)
}

async function isConnected($: EngineInterface): Promise<boolean> {
  if (connected) return true
  try {
    connected = (await $.tool.list()).some((t) => WITNESS_TOOL.test(t.name))
  } catch {
    connected = false
  }
  return connected
}

/** What the rail draws from; read while drawing, so a later write draws it again. */
async function railFacts($: EngineInterface): Promise<RailFacts> {
  const held = await heldCards($)
  return {
    cards: held,
    artifacts: await heldArtifacts($),
    tree: await heldTree($),
    pages: await heldPages($),
    isConnected: held.length > 0 || (await isConnected($)),
  }
}

/** Opens the rail: docked 44 columns wide, inline as tall as its lines with the folds that fit fourteen. */
async function openRail($: EngineInterface): Promise<void> {
  const rows = inlineRows(await railFacts($))
  const opened = await $.ui.open({ id: RAIL, title: RAIL, columns: RAIL_COLUMNS, rows })
  if (opened.isPlaced) await changeRail($, (h) => ({ ...h, shown: true }))
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
  const history = await railHistory($)
  if (history.autoOpened || history.closedByPerson) return
  const where = await surfaces($)
  if (where.length === 0) return
  if (!(where.some((s) => s === 'desktop' || s === 'vscode') || fullscreen === true)) return
  await changeRail($, (h) => ({ ...h, autoOpened: true }))
  await openRail($)
}

/**
 * While the rail sits inline, a card or an artifact that arrives asks the engine for the
 * new height with another open of the same id; the engine may grow the pane or not.
 */
async function growInline($: EngineInterface): Promise<void> {
  if (placement !== 'inline') return
  if (!(await railOpen($, false))) return
  const rows = inlineRows(await railFacts($))
  await $.ui.open({ id: RAIL, title: RAIL, columns: RAIL_COLUMNS, rows })
}

/** The session's repository root, or null. */
async function repoRoot($: EngineInterface): Promise<string | null> {
  try {
    return (await $.session.repo())?.root ?? null
  } catch {
    return null
  }
}

/** The session's own folder, or undefined. */
async function sessionRoot($: EngineInterface): Promise<string | undefined> {
  try {
    return await $.session.root()
  } catch {
    return undefined
  }
}

/** The branch `git rev-parse --abbrev-ref HEAD` names; null for a detached head, no git, or an error. */
async function readBranch($: EngineInterface): Promise<string | null> {
  try {
    const ran = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 10_000 })
    const out = ran.stdout.trim()
    // A detached head reads `HEAD`: no branch.
    return ran.exitCode === 0 && out && out !== 'HEAD' ? out : null
  } catch {
    return null
  }
}

/** The branch's pull request as `gh pr view` prints it; null for none, no gh, or an error. */
async function readPullRequest($: EngineInterface): Promise<WitnessTree['pullRequest']> {
  try {
    const ran = await $.process.run(['gh', 'pr', 'view', '--json', 'number,title,url,state,isDraft,baseRefName'], {
      timeoutMs: 15_000,
    })
    return ran.exitCode === 0 ? parsePullRequest(ran.stdout) : null
  } catch {
    return null
  }
}

/**
 * The working tree, read at session start, after a Bash call that may have moved the
 * pull request, and at each `/witness`; never polled. No git, no `gh`, no pull request,
 * or an error: that part is absent. Never throws.
 */
async function refreshTree($: EngineInterface): Promise<void> {
  try {
    // No surface (\`-p\`, an SDK host, a Mac app session): nothing draws the rail, so no gh, no git.
    if ((await surfaces($)).length === 0) return
    const root = await repoRoot($)
    const branch = await readBranch($)
    const pullRequest = await readPullRequest($)
    const repository = root ? (root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? null) : null
    await keepTree($, { branch, repository, pullRequest })
  } catch {
    // The rail keeps what it had.
  }
}

/** How long the edit's result waits on a `covers` answer before it goes without a note. */
const COVERS_WAIT_MS = 2000

/** The cards one project says cover `path`; none when not connected or the server failed. */
async function askCovers($: EngineInterface, projectId: string, proof: WitnessProof, path: string): Promise<string[]> {
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
}

/**
 * The note for one file, or undefined: once per path per session, on each project the
 * session has read with a proof, never for a path the agent asked `covers` about itself.
 * Nothing covers it, no answer within two seconds, or anything fails: undefined.
 */
async function coversNote($: EngineInterface, filePath: string): Promise<string | undefined> {
  const known = await heldProofs($)
  const projects = Object.keys(known)
  if (projects.length === 0) return undefined

  const repo = await repoRoot($)
  const root = await sessionRoot($)
  const path = relativeTo(filePath, [...(repo ? [repo] : []), ...(root ? [root] : [])])
  if (!path) return undefined

  let first = false
  await changeAsked($, (list) => {
    first = !list.includes(path)
    return first ? [...list, path] : list
  })
  if (!first) return undefined

  const lookups: Promise<string[]>[] = []
  for (const projectId of projects) lookups.push(askCovers($, projectId, known[projectId]!, path))
  const stop = new AbortController()
  const found = await Promise.race([
    Promise.all(lookups).then((each) => each.flat()),
    waitFor($, COVERS_WAIT_MS, stop.signal),
  ])
  stop.abort()
  return note(found ?? [], path)
}

/**
 * The rail's tree on one surface: every row one line, two cells in under its header, cut
 * with `…` at the body's width. The glyph is a terminal cell on the terminal and the
 * phone, and the page's own SVG on desktop and VS Code.
 */
function drawRail($: EngineInterface, e: RenderInput<'Pane'>, rows: readonly RailRow[]) {
  const elements = $.ui.resolve(e)
  const { Box, Text, Link } = elements
  const Svg = (e.surface === 'desktop' || e.surface === 'vscode') && 'Svg' in elements ? elements.Svg : undefined
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
            <Text dimColor>{row.count + ' more'}</Text>
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
              {title ? ' ' + title : ''}
            </Link>
          </Text>
        ) : (
          <Text>
            <Text dimColor>{card.id}</Text>
            {title ? ' ' + title : ''}
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
    void refreshTree($)
    return started
  })

  /** `/witness` opens the rail at any width, docked or inline as the screen allows, and closes it when open. */
  on('command.run', { command: 'witness' }, async ($, e) => {
    fullscreen = e.presentation.isFullscreen
    if (await railOpen($, false)) {
      await $.ui.close({ id: RAIL })
      return {}
    }
    // Open from what is held, at once; the tree is read after, and the rail redraws when
    // it lands. gh can take many seconds, and a command waits on nothing it does not need.
    await openRail($)
    void refreshTree($)
    return {}
  })

  /** A rail the person closed stays closed: nothing reopens it unasked. */
  on('ui.close', { id: 'witness' }, async ($, e, next) => {
    const closed = await next(e)
    if (e.origin.kind === 'person') await changeRail($, (h) => ({ ...h, closedByPerson: true }))
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
    const held = await heldCards($)
    if (held.length === 0) return next(e)
    if (await railOpen($, true)) return next(e)
    const tail = hintTail(held, (await railHistory($)).shown, e.props.hint, e.viewport?.columns)
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
    if (touchesPullRequest(e.command)) void refreshTree($)
    return ran
  })

  /** An artifact this session published joins the rail. */
  on('tool.call', { tool: /^Artifact$/ }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran
    const result = isRecord(ran.result) ? ran.result : parse(ran.text)
    const published = publishedArtifact(e as Record<string, unknown>, result)
    if (published) {
      await changeArtifacts($, (list) => withArtifact(list, published)).catch(() => {})
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
