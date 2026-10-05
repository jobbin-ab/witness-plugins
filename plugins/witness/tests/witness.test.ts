import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { NOT_YET, WATCHED } from '../hooks/done'
import { glyphCell, glyphColour } from '../hooks/glyphs'
import { cardUrl, cells, cut, fitRows, hintTail, inlineRows, parsePullRequest, touchesPullRequest } from '../hooks/rail'

const PROJECT = 'p-test'
const PROOF = 'proof-1'
const ROOT = '/work/shop'

type Seen = {
  asked: { question: string; header: string; options: string[] }[]
  sent: Record<string, unknown>[]
  status: (string | undefined)[]
  covers: string[]
  opens: { id: string; title?: string; columns?: number; rows?: number }[]
  closes: string[]
  panes: { id: string; isPlaced: boolean }[]
  runs: string[]
  clock: ReturnType<typeof mock.clock>
}

const GH_PR = JSON.stringify({
  number: 365,
  title: 'Sessions: a pasted screenshot is kept once in the transcript',
  url: 'https://github.com/robingedda/witness/pull/365',
  state: 'OPEN',
  isDraft: true,
  baseRefName: 'main',
})

/**
 * The engine and the witness server stood in beneath the plugin. `answer` is what the
 * person does with the question: a label, free text, `dismiss`, or `nobody` (no
 * surface; the dialog rejects). `covering` is what the server answers for a `covers`
 * read, after `coversDelayMs` on the mocked clock or never when `coversFail`; `server`
 * is what it answers for every other call, by operation. `surface` is where the session
 * draws, `placed` whether an open pane is seated, `connected` whether witness tools are
 * listed, `pr` what `gh pr view` prints (absent: no pull request).
 */
function stand(
  on: On,
  options: {
    answer?: string
    covering?: Record<string, unknown>[]
    coversFail?: boolean
    coversDelayMs?: number
    server?: (args: Record<string, unknown>, op: string) => unknown
    surface?: 'terminal' | 'desktop'
    placed?: boolean
    connected?: boolean
    pr?: string
    prNeverAnswers?: boolean
    branch?: string
    noRepo?: boolean
  } = {},
): Seen {
  const clock = mock.clock(on)
  const seen: Seen = { asked: [], sent: [], status: [], covers: [], opens: [], closes: [], panes: [], runs: [], clock }
  const answer = options.answer ?? WATCHED

  on('session.surfaces', () => ({ value: answer === 'nobody' ? [] : [options.surface ?? 'terminal'] }))
  on('session.repo', () => ({ value: options.noRepo ? null : { root: ROOT, remote: null, internal: false, name: null } }))
  on('session.root', () => ({ value: `${ROOT}/packages/cart` }))
  on('ui.status', ($, e) => {
    seen.status.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    seen.opens.push({ id: e.id, title: e.title, columns: e.columns, rows: e.rows })
    const isPlaced = options.placed ?? true
    if (!seen.panes.some((p) => p.id === e.id)) seen.panes.push({ id: e.id, isPlaced })
    return { value: isPlaced ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'narrow' as never } }
  })
  on('ui.close', ($, e) => {
    seen.closes.push(e.id)
    seen.panes = seen.panes.filter((p) => p.id !== e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: seen.panes.map((p) => ({ id: p.id, title: p.id, isShown: true, isFocused: false, isPlaced: p.isPlaced })),
  }))
  on('tool.list', () => ({
    value: options.connected === false ? [] : [{ name: 'mcp__plugin_witness_witness__witness_list_cards', description: '' } as never],
  }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('process.run', async ($, e) => {
    const [cmd] = e.argv
    seen.runs.push(e.argv.join(' '))
    const ran = (exitCode: number, stdout: string) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd === 'git') return options.noRepo ? ran(128, '') : ran(0, `${options.branch ?? 'claude/gn-304-6355'}\n`)
    if (options.prNeverAnswers) await new Promise(() => {})
    if (options.pr) return { value: { exitCode: 0, stdout: options.pr, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: 1, stdout: '', stderr: 'no pull requests found', isStdoutTruncated: false, isStderrTruncated: false } }
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
    const body = options.server
      ? options.server(args, op)
      : { card: { id: args.id ?? 'GN-1', status: args.status ?? 'ready', title: `Title of ${String(args.id ?? 'GN-1')}` } }
    if (body === 'refuse') return { deny: 'Ready asserts the requirement is settled.' }
    return { result: { content: [{ type: 'text', text: JSON.stringify(body) }] } }
  })
  on('tool.call', { tool: /^(Edit|Write)$/ }, () => ({ result: { filePath: 'x' } }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } as never }))
  on('tool.call', { tool: 'Artifact' }, ($, e) => ({
    result: { url: 'https://claude.ai/code/artifact/abc', path: 'before-after.html', title: String((e as { title?: string }).title ?? '') } as never,
  }))
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

const PANE = (bodyColumns = 44) => ({
  title: 'witness',
  isFocused: false,
  bodyColumns,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
})
const WITNESS = (columns = 120, isFullscreen = false) =>
  ({
    command: 'witness',
    args: '',
    origin: { kind: 'person' } as never,
    presentation: { isFullscreen, columns },
  }) as const
const own = (op: string) => `mcp__plugin_witness_witness__witness_${op}` as const
const call = { projectId: PROJECT, readProof: PROOF }

/** The hint line as the engine would draw it, the tail the plugin added recorded. */
function hintLine(on: On): (string | undefined)[] {
  const tails: (string | undefined)[] = []
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    tails.push(e.props.tail)
    return { type: 'Text', props: {}, children: [e.props.hint] } as never
  })
  return tails
}
const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }

/**
 * Whether a row shows `text`. The kit reads a Text holding a Link as the link's address
 * followed by its words, so a linked row is matched by how it ends.
 */
function expectShown(texts: readonly string[], text: string) {
  expect(texts.some((t) => t === text || (/^https:\/\/\S/.test(t) && t.endsWith(text)))).toBe(true)
}

describe('the session rail', () => {
  test('draws PULL REQUEST, CARDS, ARTIFACT and ABOUT on the terminal and on desktop', async ($, on) => {
    const seen = stand(on, {
      pr: GH_PR,
      server: (args, op) =>
        op === 'claim_card'
          ? { card: { id: args.id, status: args.id === 'GN-304' ? 'verify' : 'investigating', title: args.id === 'GN-304' ? 'Sessions: a pasted screenshot is kept once in the transcript' : 'Sessions: how long an archived session is kept' } }
          : {},
    })
    await $.tool.call({ tool: own('claim_card'), ...call, id: 'GN-304', note: 'x' })
    await $.tool.call({ tool: own('claim_card'), ...call, id: 'GN-433', note: 'y' })
    await $.tool.call({ tool: 'Artifact', file_path: 'before-after.html', title: 'GN-431 before and after' })
    await $.command.run(WITNESS())
    await seen.clock.settle()
    expect(seen.status).toEqual([])
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'witness', surface, component: 'Pane', requestId: 'witness', props: PANE() })
      const texts = (await ui.findAll({ type: 'Text' })).map((t) => t.text)
      const headers = texts.filter((t) => /^[A-Z][A-Z ]+$/.test(t))
      expect(headers).toEqual(['PULL REQUEST', 'CARDS', 'ARTIFACT', 'ABOUT'])
      // Every row one line: docked, the 44-column body less the gutter's two cells and the
      // two-cell indent, cut with … as the last cell.
      expectShown(texts, 'Sessions: a pasted screenshot is kept o…')
      expectShown(texts, '#365 · Draft')
      expectShown(texts, 'GN-304 Sessions: a pasted screenshot …')
      expectShown(texts, 'claude/gn-304-6355')
      expectShown(texts, 'shop from main')
      expectShown(texts, 'GN-431 before and after')
      const hrefs = (await ui.findAll({ type: 'Link' })).map((l) => l.props.href)
      expect(hrefs).toEqual([
        'https://github.com/robingedda/witness/pull/365',
        'https://github.com/robingedda/witness/pull/365',
        'https://witness.nu/r/p-test#/cards/GN-304',
        'https://witness.nu/r/p-test#/cards/GN-433',
        'https://claude.ai/code/artifact/abc',
      ])
      if (surface === 'terminal') {
        expect((await ui.find({ type: 'Text', text: '◕' }))?.props.color).toBe('magenta')
        expect((await ui.find({ type: 'Text', text: '○' }))?.props.color).toBeUndefined()
        expect(await ui.findAll({ type: 'Svg' })).toEqual([])
      } else {
        const svgs = await ui.findAll({ type: 'Svg' })
        expect(svgs.map((s) => s.props.alt)).toEqual(['Needs verification', 'Investigating'])
        expect(String(svgs[0]!.props.source)).toContain('#ae8cec')
      }
      await ui.unmount()
    }
  })

  test('a card from another server name draws without a link; ABOUT names no base without a pull request', async ($, on) => {
    const seen = stand(on)
    await $.tool.call({ tool: 'mcp__witness-dev__witness_claim_card', ...call, id: 'GN-7', note: 'x' })
    await $.command.run(WITNESS())
    await seen.clock.settle()
    const ui = await $.ui.mount({ plugin: 'witness', surface: 'terminal', component: 'Pane', requestId: 'witness', props: PANE() })
    const texts = (await ui.findAll({ type: 'Text' })).map((t) => t.text)
    expect(await ui.findAll({ type: 'Link' })).toEqual([])
    expect(texts.filter((t) => /^[A-Z][A-Z ]+$/.test(t))).toEqual(['CARD', 'ABOUT'])
    expectShown(texts, 'shop')
    expect(texts.some((t) => t.includes(' from '))).toBe(false)
  })

  test('not connected stands where CARDS would, whatever else is drawn', async ($, on) => {
    const seen = stand(on, { connected: false })
    await $.command.run(WITNESS())
    await seen.clock.settle()
    const ui = await $.ui.mount({ plugin: 'witness', surface: 'terminal', component: 'Pane', requestId: 'witness', props: PANE() })
    const texts = (await ui.findAll({ type: 'Text' })).map((t) => t.text)
    expect(texts.slice(0, 3)).toEqual(['witness is not connected. Sign in with /mcp.', ' ', 'ABOUT'])
  })

  test('connected with no card yet says nothing while there is anything else to draw', async ($, on) => {
    const seen = stand(on)
    await $.command.run(WITNESS())
    await seen.clock.settle()
    const ui = await $.ui.mount({ plugin: 'witness', surface: 'desktop', component: 'Pane', requestId: 'witness', props: PANE() })
    const texts = (await ui.findAll({ type: 'Text' })).map((t) => t.text)
    expect(texts.filter((t) => /^[A-Z][A-Z ]+$/.test(t))).toEqual(['ABOUT'])
    expect(texts.some((t) => t.includes('No card yet'))).toBe(false)
  })

  test('with nothing at all to draw, the frame says no card yet in two rows', async ($, on) => {
    stand(on, { noRepo: true })
    await $.command.run(WITNESS())
    const ui = await $.ui.mount({ plugin: 'witness', surface: 'terminal', component: 'Pane', requestId: 'witness', props: PANE() })
    expect((await ui.findAll({ type: 'Text' })).map((t) => t.text)).toEqual(['No card yet.', "The agent's first card appears here."])
  })

  test('/witness opens it at 44 columns and closes it when open', async ($, on) => {
    const seen = stand(on, { prNeverAnswers: true })
    // gh never answers here: the command opens from what is held and waits on nothing.
    await $.command.run(WITNESS())
    // Nothing read yet: `No card yet.` and its second row.
    expect(seen.opens).toEqual([{ id: 'witness', title: 'witness', columns: 44, rows: 2 }])
    await $.command.run(WITNESS())
    expect(seen.closes).toEqual(['witness'])
  })

  test('the first card opens it unasked, once, only where it docks', async ($, on) => {
    const seen = stand(on)
    const tails = hintLine(on)
    // The terminal says it draws the fullscreen layout.
    await $.ui.mount({ plugin: 'witness', surface: 'terminal', component: 'PromptHint', props: HINT, viewport: { columns: 150, rows: 40, isFullscreen: true } })
    await $.tool.call({ tool: own('claim_card'), ...call, id: 'GN-1', note: 'x' })
    await $.tool.call({ tool: own('claim_card'), ...call, id: 'GN-2', note: 'x' })
    expect(seen.opens.map((o) => o.id)).toEqual(['witness'])
    // Down to none and back to one is not a second first card.
    await $.tool.call({ tool: own('release_card'), ...call, id: 'GN-1' })
    await $.tool.call({ tool: own('release_card'), ...call, id: 'GN-2' })
    await $.tool.call({ tool: own('claim_card'), ...call, id: 'GN-3', note: 'x' })
    expect(seen.opens.map((o) => o.id)).toEqual(['witness'])
    expect(tails).toEqual([undefined])
  })

  test('on the main screen it waits for /witness, and the hint line carries the cards', async ($, on) => {
    const seen = stand(on)
    const tails = hintLine(on)
    const main = { columns: 80, rows: 30, isFullscreen: false }
    await $.ui.mount({ plugin: 'witness', surface: 'terminal', component: 'PromptHint', props: HINT, viewport: main })
    await $.tool.call({ tool: own('claim_card'), ...call, id: 'GN-304', note: 'x' })
    await $.tool.call({ tool: own('update_card'), ...call, id: 'GN-304', version: 2, status: 'verify' })
    await $.tool.call({ tool: own('claim_card'), ...call, id: 'GN-433', note: 'x' })
    expect(seen.opens).toEqual([])
    await $.ui.mount({ plugin: 'witness', surface: 'terminal', component: 'PromptHint', props: HINT, viewport: main })
    expect(tails.at(-1)).toBe('◕ GN-304 · ◐ GN-433 · /witness')
    await $.command.run(WITNESS(80, false))
    await $.command.run(WITNESS(80, false))
    await seen.clock.settle()
    await $.ui.mount({ plugin: 'witness', surface: 'terminal', component: 'PromptHint', props: HINT, viewport: main })
    expect(tails.at(-1)).toBe('◕ GN-304 · ◐ GN-433')
  })

  test('no tail while the rail is placed, and no tail with no card', async ($, on) => {
    stand(on)
    const tails = hintLine(on)
    await $.ui.mount({ plugin: 'witness', surface: 'terminal', component: 'PromptHint', props: HINT })
    await $.tool.call({ tool: own('claim_card'), ...call, id: 'GN-1', note: 'x' })
    await $.command.run(WITNESS())
    await $.ui.mount({ plugin: 'witness', surface: 'terminal', component: 'PromptHint', props: HINT })
    expect(tails.length).toBeGreaterThan(1)
    expect(tails.every((t) => t === undefined)).toBe(true)
  })

  test('no surface: never opened, nothing drawn, no gh or git run', async ($, on) => {
    const seen = stand(on, { answer: 'nobody' })
    await $.tool.call({ tool: own('claim_card'), ...call, id: 'GN-1', note: 'x' })
    await $.tool.call({ tool: 'Bash', command: 'git push' })
    await seen.clock.settle()
    expect(seen.opens).toEqual([])
    expect(seen.status).toEqual([])
    expect(seen.runs).toEqual([])
  })

  test('a detached head is no branch', async ($, on) => {
    const seen = stand(on, { branch: 'HEAD' })
    await $.command.run(WITNESS())
    await seen.clock.settle()
    const ui = await $.ui.mount({ plugin: 'witness', surface: 'terminal', component: 'Pane', requestId: 'witness', props: PANE() })
    const texts = (await ui.findAll({ type: 'Text' })).map((t) => t.text)
    expect(texts.includes('HEAD')).toBe(false)
    expectShown(texts, 'shop')
  })

  test('inline, the rows fold to the height the engine gave', async ($, on) => {
    const seen = stand(on, { noRepo: true })
    for (const id of ['GN-1', 'GN-2', 'GN-3']) await $.tool.call({ tool: own('claim_card'), ...call, id, note: 'x' })
    await $.command.run(WITNESS())
    const inline = { ...PANE(60), placement: 'inline' as const, scroll: { offset: 0, bodyRows: 3 } }
    const ui = await $.ui.mount({ plugin: 'witness', surface: 'terminal', component: 'Pane', requestId: 'witness', props: inline })
    const texts = (await ui.findAll({ type: 'Text' })).map((t) => t.text)
    expect(texts.filter((t) => /^[A-Z][A-Z ]+$/.test(t) || t.endsWith('more'))).toEqual(['CARDS', '2 more'])
    expect((await ui.findAll({ type: 'Link' })).length).toBe(1)
    void seen
  })

  test('a card that arrives while the rail sits inline asks for the new height', async ($, on) => {
    const seen = stand(on, { noRepo: true })
    await $.tool.call({ tool: own('claim_card'), ...call, id: 'GN-1', note: 'x' })
    await $.command.run(WITNESS())
    const inline = { ...PANE(60), placement: 'inline' as const, scroll: { offset: 0, bodyRows: 2 } }
    await $.ui.mount({ plugin: 'witness', surface: 'terminal', component: 'Pane', requestId: 'witness', props: inline })
    await $.tool.call({ tool: own('claim_card'), ...call, id: 'GN-2', note: 'x' })
    expect(seen.opens.map((o) => o.rows)).toEqual([2, 3])
  })

  test('server-accepted statuses and titles, a refused Done, a release', async ($, on) => {
    stand(on, {
      surface: 'desktop',
      server: (args, op) => {
        if (op === 'release_card') return { card: { id: args.id, status: 'ready', title: 'T', claim: null } }
        if (args.note) return { card: { id: args.id, status: 'ready', title: `Title ${String(args.id)}` } }
        if (args.status === 'done') return { error: 'version_conflict', current: { id: args.id, status: 'verify', title: 'Renamed' } }
        return { card: { id: args.id, status: args.status, title: `Title ${String(args.id)}` } }
      },
    })
    await $.tool.call({ tool: own('claim_card'), ...call, id: 'GN-304', note: 'x' })
    await $.tool.call({ tool: own('claim_card'), ...call, id: 'GN-433', note: 'x' })
    await $.tool.call({ tool: own('update_card'), ...call, id: 'GN-304', version: 2, status: 'done', verifiedBy: 'Robin' })
    await $.tool.call({ tool: own('release_card'), ...call, id: 'GN-433' })
    const ui = await $.ui.mount({ plugin: 'witness', surface: 'desktop', component: 'Pane', requestId: 'witness', props: PANE() })
    expect((await ui.findAll({ type: 'Svg' })).map((s) => s.props.alt)).toEqual(['Needs verification'])
    expectShown((await ui.findAll({ type: 'Text' })).map((t) => t.text), 'GN-304 Renamed')
  })

  test('a gh pr or git push command reads the pull request again', async ($, on) => {
    const seen = stand(on, { pr: GH_PR })
    await $.tool.call({ tool: own('claim_card'), ...call, id: 'GN-1', note: 'x' })
    await $.tool.call({ tool: 'Bash', command: 'git push -u origin HEAD' })
    await seen.clock.settle()
    const ui = await $.ui.mount({ plugin: 'witness', surface: 'terminal', component: 'Pane', requestId: 'witness', props: PANE() })
    expectShown((await ui.findAll({ type: 'Text' })).map((t) => t.text), '#365 · Draft')
  })
})

describe('the rail, plain', () => {
  test('glyph cells, with the retired keys in the shape of what they meant', () => {
    const keys = ['triage', 'investigating', 'decision', 'ready', 'verify', 'done', 'byDesign', 'parked', 'blocked', 'cancelled', 'open', 'fixed', 'inbox']
    expect(keys.map(glyphCell).join('')).toBe('⊙○◌◐◕●●⊖⊗⊘○●⊙')
    expect(keys.map((k) => glyphColour(k) ?? '-')).toEqual(['-', '-', 'yellow', 'blue', 'magenta', '-', '-', '-', 'red', '-', '-', '-', '-'])
  })

  test('the pull request state as gh says it', () => {
    const pr = (o: Record<string, unknown>) => parsePullRequest(JSON.stringify({ number: 1, url: 'https://x', title: 't', baseRefName: 'main', ...o }))
    expect(pr({ state: 'OPEN', isDraft: true })?.state).toBe('Draft')
    expect(pr({ state: 'OPEN', isDraft: false })?.state).toBe('Open')
    expect(pr({ state: 'MERGED' })?.state).toBe('Merged')
    expect(pr({ state: 'CLOSED' })?.state).toBe('Closed')
    expect(pr({ state: 'OPEN' })?.base).toBe('main')
    expect(parsePullRequest('no pull requests found')).toBeNull()
  })

  test('the card link is the page address for the plugin’s own server only', () => {
    expect(cardUrl({ server: 'plugin_witness_witness', projectId: 'p 1', id: 'GN-4' })).toBe('https://witness.nu/r/p%201#/cards/GN-4')
    expect(cardUrl({ server: 'witness-dev', projectId: 'p', id: 'GN-4' })).toBeUndefined()
  })

  test('the fold: as many card rows as fit, at least one, then n more; then artifacts; a fold saving nothing is not made', () => {
    const tree = { branch: 'b', repository: 'witness', pullRequest: { number: 1, title: 't', url: 'https://x', state: 'Open', base: 'main' } }
    const card = (n: number) => ({ id: `GN-${n}`, projectId: 'p', status: 'ready', title: 't', server: 's' })
    const art = (n: number) => ({ url: `https://a/${n}`, title: `a${n}` })
    const facts = (c: number, a: number) => ({
      cards: Array.from({ length: c }, (_, i) => card(i + 1)),
      artifacts: Array.from({ length: a }, (_, i) => art(i + 1)),
      tree,
      isConnected: true,
    })
    const shape = (rows: ReturnType<typeof fitRows>) => rows.map((r) => (r.kind === 'more' ? `${r.count} more` : r.kind)).join(',')
    // The usual size, four sections at fourteen rows: nothing folds.
    expect(fitRows(facts(2, 1), 14).length).toBe(14)
    expect(inlineRows(facts(2, 1))).toBe(14)
    // Three cards, one row over: two and `1 more` saves nothing, so one and `2 more`.
    expect(shape(fitRows(facts(3, 1), 14))).toContain('header,card,2 more,gap')
    expect(fitRows(facts(3, 1), 14).length).toBe(14)
    // Two sections over: CARDS to its floor, then ARTIFACTS; at the floor it may still overflow.
    const both = fitRows(facts(6, 5), 14)
    expect(shape(both)).toContain('header,card,5 more,gap,header,link,4 more,gap')
    // The one shape that still overflows asks for fifteen: the cap is the usual size, not a wall.
    expect(both.length).toBe(15)
    expect(inlineRows(facts(6, 5))).toBe(15)
    // Docked, nothing folds.
    expect(fitRows(facts(6, 5), Number.POSITIVE_INFINITY).filter((r) => r.kind === 'card').length).toBe(6)
  })

  test('the hint tail fits the row with a cell to spare, dropping /witness and then the last card', () => {
    const cards = [
      { id: 'GN-304', projectId: 'p', status: 'verify', title: '', server: 's' },
      { id: 'GN-433', projectId: 'p', status: 'investigating', title: '', server: 's' },
    ]
    // `hint` as the engine hands it, without the mode pill it draws before it.
    const hint = '? for shortcuts · ← for agents'
    expect(hintTail(cards, false, hint, 80)).toBe('◕ GN-304 · ○ GN-433')
    expect(hintTail(cards, false, hint, 72)).toBe('◕ GN-304')
    expect(hintTail(cards, false, hint, 64)).toBeUndefined()
    expect(hintTail(cards, false, '? for shortcuts', 100)).toBe('◕ GN-304 · ○ GN-433 · /witness')
  })

  test('cells: wide characters take two, and the cut never splits one', () => {
    expect(cells('GN-1 修正')).toBe(9)
    expect(cells('ok 🎉')).toBe(5)
    expect(cut('修正修正修正', 6)).toBe('修正…')
    expect(cells(cut('修正修正修正', 6))).toBeLessThanOrEqual(6)
    expect(cut('abcdef', 6)).toBe('abcdef')
  })

  test('which commands move the pull request', () => {
    expect(['gh pr create --draft', 'git push', 'git -C x push origin', 'cd a && gh pr edit 3'].every(touchesPullRequest)).toBe(true)
    expect(['git status', 'gh issue list', 'echo push'].some(touchesPullRequest)).toBe(false)
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
