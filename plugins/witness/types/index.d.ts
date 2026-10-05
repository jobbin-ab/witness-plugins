/**
 * What the witness mod keeps for the session in `$.state`. Nothing here is read by the
 * server, the page or the Mac app: it is this session's own memory of its own calls.
 */

/** A card this session holds a claim on or wrote, with the status the server last answered. */
export type WitnessHeldCard = {
  id: string
  projectId: string
  status: string
}

/** The last read proof a call to a project carried, and the server that took it. */
export type WitnessProof = {
  server: string
  readProof: string
}

declare module 'claude-code' {
  interface PluginState {
    witness: {
      /** The session's cards, in the order it first took or wrote them. */
      cards: WitnessHeldCard[]
      /** Per project id, the proof and server of the session's last call that landed there. */
      proofs: Record<string, WitnessProof>
      /** Repository-relative paths already asked about by `covers`, by the mod or by the agent. */
      asked: string[]
    }
  }
}
