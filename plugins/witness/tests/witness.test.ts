import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { NOT_YET, WATCHED } from '../hooks/done'

const PROJECT = 'p-test'
const PROOF = 'proof-1'
const ROOT = '/work/shop'

type Seen = {
  asked: { question: string; header: string; options: string[] }[]
  sent: Record<string, unknown>[]
  status: (string | undefined)[]
  covers: string[]
  clock: ReturnType<typeof mock.clock>
}

/**
 * The engine and the witness server stood in beneath the plugin. `answer` is what the
 * person does with the question: a label, free text, `dismiss`, or `nobody` (no
 * surface; the dialog rejects). `covering` is what the server answers for a `covers`
 * read, after `coversDelayMs` on the mocked clock or never when `coversFail`; `server`
 * is what it answers for every other call, by operation.
 */
function stand(
  on: On,
  options: {
    answer?: string
    covering?: Record<string, unknown>[]
    coversFail?: boolean
    coversDelayMs?: number
    server?: (args: Record<string, unknown>, op: string) => unknown
  } = {},
): Seen {
  const clock = mock.clock(on)
  const seen: Seen = { asked: [], sent: [], status: [], covers: [], clock }
  const answer = options.answer ?? WATCHED

  on('session.surfaces', () => ({ value: answer === 'nobody' ? [] : (['terminal'] as const) }))
  on('session.repo', () => ({ value: { root: ROOT, remote: null, internal: false, name: null } }))
  on('session.root', () => ({ value: `${ROOT}/packages/cart` }))
  on('ui.status', ($, e) => {
    seen.status.push(e.text)
    return { value: undefined }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    const q = e.questions[0]!
    seen.asked.push({ question: q.question, header: q.header, options: q.options.map((o) => o.label) })
    if (answer === 'dismiss' || answer === 'nobody') return { deny: 'The user dismissed the question.' }
    return { result: { questions: e.questions, answers: { [q.question]: answer } } }
  })
  on('mcp.call', async ($, e) => {
    seen.covers.push(String(e.args.covers))
    if (options.coversFail) throw new Error('connection refused')
    if (options.coversDelayMs) await clock.sleep(options.coversDelayMs)
    const body = { cards: options.covering ?? [] }
    return { value: { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false } }
  })
  on('tool.call', { tool: /^mcp__/ }, ($, e) => {
    const { tool, tool_use_id: _id, agentId: _a, ...args } = e as Record<string, unknown>
    seen.sent.push(args)
    const op = String(tool).replace(/^.*__witness_/, '')
    const body = options.server ? options.server(args, op) : { card: { id: args.id ?? 'GN-1', status: args.status ?? 'ready' } }
    if (body === 'refuse') return { deny: 'Ready asserts the requirement is settled.' }
    return { result: { content: [{ type: 'text', text: JSON.stringify(body) }] } }
  })
  on('tool.call', { tool: /^(Edit|Write)$/ }, () => ({ result: { filePath: 'x' } }))
  return seen
}

const DONE = {
  tool: 'mcp__witness__witness_update_card',
  projectId: PROJECT,
  readProof: PROOF,
  id: 'GN-412',
  version: 3,
  status: 'done',
  verifiedBy: 'Robin',
  actorKind: 'human',
} as const

const refused = (ran: { deny?: string; text?: string }) => String(ran.deny ?? ran.text)

describe('a Done in your name', () => {
  test('I watched it work: the write goes through unchanged', async ($, on) => {
    const seen = stand(on, { answer: WATCHED })
    const ran = await $.tool.call(DONE)
    expect(ran.deny).toBeUndefined()
    expect(seen.asked).toEqual([
      {
        question: 'GN-412 goes to Done, verified by Robin. Did you watch it work?',
        header: 'witness',
        options: ['I watched it work', 'Not yet'],
      },
    ])
    const { tool: _t, ...args } = DONE
    expect(seen.sent).toEqual([args])
  })

  test('Not yet: refused, in the person’s words, with the way to verify', async ($, on) => {
    const seen = stand(on, { answer: NOT_YET })
    const ran = await $.tool.call(DONE)
    expect(seen.sent).toEqual([])
    expect(refused(ran)).toBe(
      'The person says they have not watched it work. Put what you ran in `verification` and send `status: verify`; a person takes it from there.',
    )
  })

  test('closing the dialog is not a yes', async ($, on) => {
    const seen = stand(on, { answer: 'dismiss' })
    const ran = await $.tool.call(DONE)
    expect(seen.sent).toEqual([])
    expect(refused(ran)).toBe(
      'The person did not confirm they watched it work. Put what you ran in `verification` and send `status: verify`; a person takes it from there.',
    )
  })

  test('free text under Other is not a yes', async ($, on) => {
    const seen = stand(on, { answer: 'yes I did' })
    const ran = await $.tool.call(DONE)
    expect(seen.sent).toEqual([])
    expect(refused(ran)).toMatch(/^The person did not confirm they watched it work/)
  })

  test('nobody to ask: the write passes, and the server guards it', async ($, on) => {
    const seen = stand(on, { answer: 'nobody' })
    const ran = await $.tool.call(DONE)
    expect(ran.deny).toBeUndefined()
    expect(seen.sent.length).toBe(1)
  })

  test('only a status change to done with a name is asked about', async ($, on) => {
    const seen = stand(on, { answer: NOT_YET })
    await $.tool.call({ ...DONE, status: 'verify', verifiedBy: undefined, verification: 'ran it on staging' })
    await $.tool.call({ ...DONE, status: undefined })
    await $.tool.call({ ...DONE, tool: 'mcp__witness__witness_comment', status: undefined, verifiedBy: undefined, body: 'Robin saw it' })
    expect(seen.asked).toEqual([])
    expect(seen.sent.length).toBe(3)
  })

  test('a filed Done names the title, under any server name', async ($, on) => {
    const seen = stand(on, { answer: NOT_YET })
    const ran = await $.tool.call({
      tool: 'mcp__plugin_witness_witness__witness_create_card',
      projectId: PROJECT,
      readProof: PROOF,
      area: 'all',
      title: 'Checkout rounds',
      status: 'done',
      verifiedBy: 'Anna',
    })
    expect(seen.asked.map((a) => a.question)).toEqual(['“Checkout rounds” is filed Done, verified by Anna. Did you watch it work?'])
    expect(refused(ran)).toMatch(/file it with `status: verify`/)
  })

  test('a batch is asked once, naming every Done and who verified it', async ($, on) => {
    const seen = stand(on, { answer: NOT_YET })
    const batch = (second: string) => ({
      tool: 'mcp__witness-dev__witness_update_cards' as const,
      projectId: PROJECT,
      readProof: PROOF,
      actorKind: 'human',
      cards: [
        { id: 'GN-1', version: 1, status: 'done', verifiedBy: 'Robin' },
        { id: 'GN-2', version: 1, title: 'Renamed' },
        { id: 'GN-3', version: 1, status: 'done', verifiedBy: second },
      ],
    })
    const ran = await $.tool.call(batch('Robin'))
    await $.tool.call(batch('Anna'))
    expect(seen.asked.map((a) => a.question)).toEqual([
      'GN-1 and GN-3 go to Done, verified by Robin. Did you watch them work?',
      'GN-1 (Robin) and GN-3 (Anna) go to Done. Did you watch them work?',
    ])
    expect(refused(ran)).toBe(
      'The person says they have not watched GN-1 or GN-3 work, so nothing in this call was written. Put what you ran in `verification` and send `status: verify` for those, and resend the other cards as they were; a person takes it from there.',
    )
  })
})

describe('the cards, on the status line', () => {
  test('claims, server-accepted statuses, and a release, as the page names them', async ($, on) => {
    const seen = stand(on, {
      server: (args, op) => {
        if (op === 'release_card') return { card: { id: args.id, status: 'ready', claim: null } }
        if (args.note) return { card: { id: args.id, status: 'ready', claim: { note: args.note } } }
        if (args.status === 'done') return { error: 'version_conflict', current: { id: args.id, status: 'verify' } }
        if (args.title) return { card: { id: 'GN-40', status: 'investigating' }, next: '…' }
        return { card: { id: args.id, status: args.status } }
      },
    })
    const call = { projectId: PROJECT, readProof: PROOF }
    await $.tool.call({ tool: 'mcp__witness__witness_claim_card', ...call, id: 'GN-304', note: 'branch x' })
    expect(seen.status.at(-1)).toBe('GN-304 Ready to build')
    await $.tool.call({ tool: 'mcp__witness__witness_update_card', ...call, id: 'GN-304', version: 2, status: 'verify', verification: 'staging' })
    await $.tool.call({ tool: 'mcp__witness__witness_claim_card', ...call, id: 'GN-433', note: 'branch y' })
    expect(seen.status.at(-1)).toBe('GN-304 Needs verification · GN-433 Ready to build')
    // The server refused the done: the status line keeps what it holds.
    await $.tool.call({ tool: 'mcp__witness__witness_update_card', ...call, id: 'GN-304', version: 2, status: 'done', verifiedBy: 'Robin' })
    expect(seen.status.at(-1)).toBe('GN-304 Needs verification · GN-433 Ready to build')
    await $.tool.call({ tool: 'mcp__witness__witness_create_card', ...call, area: 'all', title: 'New' })
    expect(seen.status.at(-1)).toBe('GN-304 Needs verification · GN-433 Ready to build +1')
    await $.tool.call({ tool: 'mcp__witness__witness_release_card', ...call, id: 'GN-433' })
    expect(seen.status.at(-1)).toBe('GN-304 Needs verification · GN-40 Investigating')
  })

  test('a refused write changes nothing', async ($, on) => {
    const seen = stand(on, {
      server: (args) => (args.status === 'ready' ? 'refuse' : { card: { id: args.id, status: 'investigating' } }),
    })
    const call = { projectId: PROJECT, readProof: PROOF }
    await $.tool.call({ tool: 'mcp__witness__witness_claim_card', ...call, id: 'GN-5', note: 'x' })
    await $.tool.call({ tool: 'mcp__witness__witness_update_card', ...call, id: 'GN-5', version: 2, status: 'ready' })
    expect(seen.status).toEqual(['GN-5 Investigating'])
  })

  test('no surface, no line', async ($, on) => {
    const seen = stand(on, { answer: 'nobody' })
    await $.tool.call({ tool: 'mcp__witness__witness_claim_card', projectId: PROJECT, readProof: PROOF, id: 'GN-5', note: 'x' })
    expect(seen.status).toEqual([])
  })
})

describe('the covered file, before the edit', () => {
  const read = { tool: 'mcp__witness__witness_list_cards', projectId: PROJECT, readProof: PROOF } as const
  const edit = (path: string) => ({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' }) as const
  const COVERING = [
    { id: 'GN-07', status: 'done', title: 'Checkout totals round wrong' },
    { id: 'GN-41', status: 'investigating', title: 'Totals off by a cent' },
  ]

  test('the note rides on the edit’s result, once per path, naming each card by its status key', async ($, on) => {
    const seen = stand(on, { covering: COVERING })
    await $.tool.call(read)
    const ran = await $.tool.call(edit(`${ROOT}/packages/cart/src/total.ts`))
    const again = await $.tool.call(edit(`${ROOT}/packages/cart/src/total.ts`))
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/packages/cart/src/total.ts`, content: '' })
    expect(ran.deny).toBeUndefined()
    expect(ran.context).toEqual([
      'witness: GN-07 (done · “Checkout totals round wrong”) and GN-41 (investigating · “Totals off by a cent”) cover src/total.ts.',
    ])
    expect(again.context).toBeUndefined()
    // The shortest relative path: the session's root lies inside the repository's.
    expect(seen.covers).toEqual(['src/total.ts'])
  })

  test('silent when nothing covers it', async ($, on) => {
    const seen = stand(on, { covering: [] })
    await $.tool.call(read)
    const ran = await $.tool.call(edit(`${ROOT}/src/a.ts`))
    expect(seen.covers).toEqual(['src/a.ts'])
    expect(ran.context).toBeUndefined()
  })

  test('nothing before the session has read a project, or for a file outside the repository', async ($, on) => {
    const seen = stand(on, { covering: COVERING })
    await $.tool.call(edit(`${ROOT}/src/a.ts`))
    expect(seen.covers).toEqual([])
    await $.tool.call(read)
    await $.tool.call(edit('/tmp/elsewhere.ts'))
    await $.tool.call(edit(`${ROOT}/src/a.ts`))
    expect(seen.covers).toEqual(['src/a.ts'])
  })

  test('never asks about a path the agent already asked covers for', async ($, on) => {
    const seen = stand(on, { server: () => ({ cards: [] }) })
    await $.tool.call({ ...read, covers: 'src/c.ts' })
    await $.tool.call(edit(`${ROOT}/src/c.ts`))
    expect(seen.covers).toEqual([])
  })

  test('a failing server is silent and the edit still runs', async ($, on) => {
    const seen = stand(on, { coversFail: true })
    await $.tool.call(read)
    const ran = await $.tool.call(edit(`${ROOT}/src/d.ts`))
    expect(ran.deny).toBeUndefined()
    expect(ran.isError).toBeUndefined()
    expect(ran.context).toBeUndefined()
    expect(seen.covers).toEqual(['src/d.ts'])
  })

  test('an answer slower than two seconds is dropped', async ($, on) => {
    const seen = stand(on, { covering: COVERING, coversDelayMs: 5000 })
    await $.tool.call(read)
    const pending = $.tool.call(edit(`${ROOT}/src/e.ts`))
    await seen.clock.advance(2000)
    const ran = await pending
    expect(ran.context).toBeUndefined()
  })
})
