/**
 * What the witness mod keeps for the session in `$.state`. Nothing here is read by the
 * server, the page or the Mac app: it is this session's own memory of its own calls and
 * of its own working tree.
 */

/** A card this session holds a claim on or wrote, as the server last answered it. */
export type WitnessHeldCard = {
  id: string
  projectId: string
  status: string
  title: string
  /** The MCP server the answer came through, as tool names spell it: its page is the one the link takes. */
  server: string
}

/** The last read proof a call to a project carried, and the server that took it. */
export type WitnessProof = {
  server: string
  readProof: string
}

/** One artifact this session published, from the Artifact tool's own result. */
export type WitnessArtifact = {
  url: string
  title: string
}

/** The pull request for the session's branch, as `gh pr view` answered. */
export type WitnessPullRequest = {
  number: number
  title: string
  url: string
  /** `Draft`, `Open`, `Merged` or `Closed`. */
  state: string
  base: string
}

/** The session's working tree: its branch, its repository's name and its pull request. */
export type WitnessTree = {
  branch: string | null
  repository: string | null
  pullRequest: WitnessPullRequest | null
}

/** The rail's history in this session, which the open rules read. */
export type WitnessRailHistory = {
  /** The rail has been placed at least once (the hint tail drops its ` · /witness`). */
  shown: boolean
  /** The one unasked open this session has been spent. */
  autoOpened: boolean
  /** The person closed it; nothing reopens it unasked. */
  closedByPerson: boolean
}

declare module 'claude-code' {
  interface PluginState {
    witness: {
      /** The session's cards, in the order it first took or wrote them. */
      cards: WitnessHeldCard[]
      /** Per project id, the proof and server of the session's last call that landed there. */
      proofs: Record<string, WitnessProof>
      /**
       * Per server and project id (`pageKey`), the project's page address, from the
       * `resource_link` named `page` that `agent_md` answers with: what a card row links to.
       */
      pages: Record<string, string>
      /** Repository-relative paths already asked about by `covers`, by the mod or by the agent. */
      asked: string[]
      /** The artifacts this session published, oldest first. */
      artifacts: WitnessArtifact[]
      /** The working tree, read at the moments the rail names. */
      tree: WitnessTree
      rail: WitnessRailHistory
    }
  }
}
