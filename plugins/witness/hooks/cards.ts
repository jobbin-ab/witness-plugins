import type { WitnessHeldCard } from '../types'
import { isRecord, type WitnessCall } from './calls'
import { statusLabel } from './labels'

/** `GN-304 Needs verification · GN-433 Investigating`; past two, the first two and `+n`. */
export function statusLine(held: readonly WitnessHeldCard[]): string | undefined {
  if (held.length === 0) return undefined
  const shown = held
    .slice(0, 2)
    .map((c) => `${c.id} ${statusLabel(c.status)}`)
    .join(' · ')
  return held.length > 2 ? `${shown} +${held.length - 2}` : shown
}

function upsert(list: WitnessHeldCard[], card: WitnessHeldCard): WitnessHeldCard[] {
  return list.some((c) => c.id === card.id)
    ? list.map((c) => (c.id === card.id ? card : c))
    : [...list, card]
}

function cardOf(v: unknown, projectId: string): WitnessHeldCard | undefined {
  if (!isRecord(v) || typeof v.id !== 'string' || typeof v.status !== 'string') return undefined
  return { id: v.id, projectId, status: v.status }
}

/**
 * How one answered witness call changes the session's cards: what the server holds,
 * never what the agent asked. A claim or a write adds the card; a release removes it; a
 * version conflict's `current` corrects a card already held. A batch answers with ids
 * only, so a landed item that sent a status takes that status, and one that sent none
 * keeps what was held. Undefined when the call changes nothing.
 */
export function cardsChange(
  call: WitnessCall,
  answer: Record<string, unknown>,
): ((list: WitnessHeldCard[]) => WitnessHeldCard[]) | undefined {
  const projectId = typeof call.input.projectId === 'string' ? call.input.projectId : ''
  switch (call.op) {
    case 'claim_card':
    case 'create_card':
    case 'update_card': {
      const card = cardOf(answer.card, projectId)
      if (card) return (list) => upsert(list, card)
      const current = cardOf(answer.current, projectId)
      if (current) return (list) => (list.some((c) => c.id === current.id) ? upsert(list, current) : list)
      return undefined
    }
    case 'release_card': {
      const card = cardOf(answer.card, projectId)
      return card ? (list) => list.filter((c) => c.id !== card.id) : undefined
    }
    case 'update_cards': {
      const landed = Array.isArray(answer.landed) ? answer.landed.filter(isRecord) : []
      const sent = Array.isArray(call.input.cards) ? call.input.cards.filter(isRecord) : []
      const known = landed.flatMap((l) => {
        const item = sent.find((s) => String(s.id ?? '').toUpperCase() === l.id)
        return typeof l.id === 'string' && item && typeof item.status === 'string'
          ? [{ id: l.id, projectId, status: item.status }]
          : []
      })
      return known.length ? (list) => known.reduce(upsert, list) : undefined
    }
  }
  return undefined
}
