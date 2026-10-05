# witness for Claude Code

[witness](https://witness.nu) is a shared project of findings: cards your agents write as
they go, and a page where you triage, decide and verify. This plugin connects it to
Claude Code. It needs Claude Code 2.1.289 or later.

## Install

```
claude plugin marketplace add robingedda/witness-plugins
claude plugin install witness
```

Then run `/mcp` in Claude Code and sign in to witness. There is no key to copy.

If you added witness with `claude mcp add` before, remove it (`claude mcp remove witness`);
the plugin brings its own.

## What it does

- **Connects witness.** Your projects, their working rules and their cards, through
  witness's MCP server at `https://witness.nu/mcp`.
- **Asks before a Done goes in your name.** When the agent is about to mark a card Done,
  verified by you, Claude Code asks you first. "I watched it work" lets it through.
  "Not yet", or closing the dialog, stops it and tells the agent to send the card to
  Needs verification.
- **Names the cards that cover a file.** Once the session has read a project, the first
  time the agent edits a file it is told which cards cover that file and where each
  stands. The file's path, relative to the repository, is sent to witness as a `covers`
  query.
- **Gives the session a rail.** A pane beside the transcript, as the witness Mac app
  has: the session's pull request, the cards it holds with their status, the artifacts it
  published, and its branch. Each row opens what it names. `/witness` shows or hides it.
  In the fullscreen layout it opens by itself once, when the session takes its first
  card; close it and it stays closed until the next `/witness`. Outside it, it waits for
  `/witness`, and the line under the prompt lists the cards meanwhile:
  `◕ GN-304 · ○ GN-433 · /witness`. The pull request is read with `gh` in the session's
  folder, when the session starts, after a `gh pr` or `git push`, and at `/witness`.

When nobody is there to ask, as in `claude -p`, the Done goes through to witness as it
would without the plugin.
