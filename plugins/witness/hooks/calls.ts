import type { ToolCallResult } from 'claude-code'

/**
 * A witness tool is known by the `witness_` prefix after `mcp__<server>__`, never by the
 * server's name: `witness`, `witness-dev`, `witness-2`, or this plugin's own
 * `plugin_witness_witness`.
 */
export const WITNESS_TOOL = /^mcp__(.+)__witness_([a-z_]+)$/

/** One witness call: the server it went to, the operation, and its arguments. */
export type WitnessCall = {
  server: string
  op: string
  input: Record<string, unknown>
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function witnessCall(e: { tool: string } & Record<string, unknown>): WitnessCall | undefined {
  const m = WITNESS_TOOL.exec(String(e.tool))
  if (!m) return undefined
  const { tool: _tool, tool_use_id: _id, agentId: _agent, consent: _consent, ...input } = e
  return { server: m[1]!, op: m[2]!, input }
}

/**
 * The JSON a witness result carries. Every row-driven witness tool returns its
 * structured result pretty-printed as the one text block, so the text is enough; the
 * structured copy is read first where the engine kept it.
 */
export function payload(ran: ToolCallResult): Record<string, unknown> | undefined {
  if (ran.deny !== undefined || ran.isError) return undefined
  const result: unknown = ran.result
  if (isRecord(result) && isRecord(result.structuredContent)) return result.structuredContent
  const text =
    ran.text ??
    (isRecord(result) && Array.isArray(result.content)
      ? result.content
          .map((b: unknown) => (isRecord(b) && b.type === 'text' && typeof b.text === 'string' ? b.text : ''))
          .join('')
      : typeof result === 'string'
        ? result
        : undefined)
  return parse(text)
}

/** The line Claude Code flattens a `resource_link` block named `page` into: `[Resource link: page] <uri>`. */
const FLATTENED_PAGE_LINK = /^\[Resource link: page\] (\S+)$/gm

/**
 * The project's page address from an `agent_md` answer: the `resource_link` named `page`.
 * Read in every shape it arrives in: a real block (a host that passes blocks through, and
 * `$.mcp.call`'s raw result), or the text line Claude Code flattens it into before a
 * `tool.call` hook sees it (`result` the block array, `text` the blocks joined). `result`
 * may be the block array, `{ content: [...] }` or a string. Taken only when the address
 * ends in `/r/<projectId>`, the page of the project asked about, so a stray link is never
 * trusted.
 */
export function pageLink(result: unknown, projectId: string, text?: string): string | undefined {
  if (!projectId) return undefined
  if (isRecord(result) && result.isError === true) return undefined
  const blocks: unknown[] = Array.isArray(result)
    ? result
    : isRecord(result) && Array.isArray(result.content)
      ? result.content
      : []
  const candidates: string[] = []
  const scan = (t: string) => {
    for (const m of t.matchAll(FLATTENED_PAGE_LINK)) candidates.push(m[1]!)
  }
  for (const b of blocks) {
    if (!isRecord(b)) continue
    if (b.type === 'resource_link' && b.name === 'page' && typeof b.uri === 'string') candidates.push(b.uri)
    if (b.type === 'text' && typeof b.text === 'string') scan(b.text)
  }
  if (typeof result === 'string') scan(result)
  if (text) scan(text)
  return candidates.find((uri) => uri.endsWith(`/r/${projectId}`))
}

export function parse(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) return undefined
  try {
    const value: unknown = JSON.parse(text)
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

export { isRecord }
