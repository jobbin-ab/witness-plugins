import { isRecord, type WitnessCall } from './calls'

export const WATCHED = 'I watched it work'
export const NOT_YET = 'Not yet'
export const HEADER = 'witness'

/** One card a write would close in a person's name: its id (or quoted title) and that name. */
export type DoneItem = { name: string; verifiedBy: string }

function named(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

/**
 * A Done in a person's name: `status: done` with `verifiedBy`. The server checks the
 * witness only on a status change, so a `verifiedBy` without a status is a stored name,
 * not a Done.
 */
function putsDone(change: Record<string, unknown>): boolean {
  return change.status === 'done' && named(change.verifiedBy)
}

/** What a Done write closes, for the question; undefined when the call closes nothing. */
export function doneWrite(call: WitnessCall): DoneItem[] | undefined {
  const { op, input } = call
  const item = (c: Record<string, unknown>, name: string): DoneItem => ({ name, verifiedBy: String(c.verifiedBy).trim() })
  if (op === 'update_card') {
    return putsDone(input) ? [item(input, String(input.id ?? '').toUpperCase())] : undefined
  }
  if (op === 'update_cards') {
    const cards = Array.isArray(input.cards) ? input.cards.filter(isRecord) : []
    const items = cards.filter(putsDone).map((c) => item(c, String(c.id ?? '').toUpperCase()))
    return items.length ? items : undefined
  }
  if (op === 'create_card') {
    return putsDone(input) ? [item(input, `“${String(input.title ?? '').trim()}”`)] : undefined
  }
  return undefined
}

export function list(items: readonly string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

/**
 * The question, carrying the name the write carries:
 * `GN-412 goes to Done, verified by Robin. Did you watch it work?`
 */
export function question(call: WitnessCall, items: readonly DoneItem[]): string {
  if (call.op === 'create_card') {
    return `${items[0]!.name} is filed Done, verified by ${items[0]!.verifiedBy}. Did you watch it work?`
  }
  if (items.length === 1) {
    return `${items[0]!.name} goes to Done, verified by ${items[0]!.verifiedBy}. Did you watch it work?`
  }
  const names = new Set(items.map((i) => i.verifiedBy))
  if (names.size === 1) {
    return `${list(items.map((i) => i.name))} go to Done, verified by ${items[0]!.verifiedBy}. Did you watch them work?`
  }
  return `${list(items.map((i) => `${i.name} (${i.verifiedBy})`))} go to Done. Did you watch them work?`
}

/**
 * The refusal the agent reads: `DONE_NEEDS_WITNESS` (`src/contract.ts`) one step earlier
 * and from the person. `said` is true when the person answered Not yet, false when they
 * closed the dialog or typed something else. A refusal, not a rewrite, so the agent knows
 * why and makes the `verify` write itself.
 */
export function refusal(call: WitnessCall, items: readonly DoneItem[], said: boolean): string {
  const ids = items.map((i) => i.name)
  const it = ids.length === 1 ? 'it' : 'those'
  const who = (what: string) =>
    said ? `The person says they have not watched ${what} work` : `The person did not confirm they watched ${what} work`
  if (call.op === 'create_card') {
    return `${who('it')}. Put what you ran in \`verification\` and file it with \`status: verify\`; a person takes it from there.`
  }
  if (call.op === 'update_cards') {
    const all = Array.isArray(call.input.cards) ? call.input.cards.length : ids.length
    const rest = all > ids.length ? ', and resend the other cards as they were' : ''
    return (
      `${who(list(ids).replace(/ and ([^ ]+)$/, ' or $1'))}, so nothing in this call was written. ` +
      `Put what you ran in \`verification\` and send \`status: verify\` for ${it}${rest}; a person takes it from there.`
    )
  }
  return `${who('it')}. Put what you ran in \`verification\` and send \`status: verify\`; a person takes it from there.`
}
