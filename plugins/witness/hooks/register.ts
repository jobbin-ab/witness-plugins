import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { WitnessHeldCard, WitnessProof } from '../types'
import { payload, witnessCall, type WitnessCall } from './calls'
import { cardsChange, statusLine } from './cards'
import { askedCovers, coveringCards, filePathOf, note, relativeTo } from './covers'
import { HEADER, NOT_YET, WATCHED, doneWrite, question, refusal, type DoneItem } from './done'

/**
 * The witness mod (docs/mod-concept.md): a Done in a person's name passes through the
 * person's hand; a file a card covers is named before it is changed; and the session's
 * cards sit on the status line. It carries no sentence of the method: that is the
 * project document's, read through the MCP tools.
 *
 * Everything that touches `$` is in this file: the engine follows `$` into a function
 * declared here and never across an import, so the other files are plain logic.
 */

const cards = atom({ plugin: 'witness', key: 'cards' } as const, [] as WitnessHeldCard[])
const proofs = atom({ plugin: 'witness', key: 'proofs' } as const, {} as Record<string, WitnessProof>)
const asked = atom({ plugin: 'witness', key: 'asked' } as const, [] as string[])

/** Draws the line where the session has a surface; one with none (a Mac app session, `-p`) draws nothing. */
async function showCards($: EngineInterface): Promise<void> {
  const surfaces = await $.session.surfaces().catch(() => [])
  if (surfaces.length === 0) return
  $.ui.status(statusLine(await read($, cards)))
}

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
  const change = cardsChange(call, answer)
  if (change) {
    await update($, cards, change)
    await showCards($)
  }
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

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await showCards($)
    return started
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
    const answer = payload(ran)
    if (answer) await recordCall($, call, answer).catch(() => {})
    return ran
  })

  /**
   * The note rides on the edit's own result, as `context`: the text the model reads right
   * after that result. The lookup starts before the edit runs and never holds it back.
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
