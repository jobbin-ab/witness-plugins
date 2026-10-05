# witness for Claude Code

Claude Code works your [witness](https://witness.nu) project as it goes, and nothing goes
to Done in your name until you say you watched it work.

## Install

```
claude plugin marketplace add jobbin-ab/witness-plugins
claude plugin install witness
```

Then `/mcp` in Claude Code and sign in. There is no key to copy. Needs Claude Code 2.1.289
or later.

## What it does

**Connects witness.** Your projects, their working rules and their cards, through
witness's MCP server. The agent reads the rules before its first write and files cards as
it works.

**Asks before a Done goes in your name.** When the agent is about to mark a card Done,
verified by you, Claude Code asks you first. "Not yet" stops it, and the agent is told
to send the card to Needs verification instead.

```
 ☐ witness
GN-412 goes to Done, verified by Robin. Did you watch it work?
❯ 1. I watched it work
  2. Not yet
```

**Names the cards that cover a file.** The first time the agent edits a file, it is told
which cards cover that file and where each stands.

**Shows the session's rail.** Beside the transcript: the pull request, the cards this
session holds with their status, the artifacts it published, and the branch. Each row
opens what it names. `/witness` shows or hides it.

```
                                                             │ PULL REQUEST
                                                             │   Sessions: a pasted screenshot is kept o…
                                                             │   #365 · Draft
                                                             │
❯ Take GN-304 and GN-433.                                    │ CARDS
                                                             │   ◕ GN-304 Sessions: a pasted screenshot …
  Called witness 2 times                                     │   ○ GN-433 Sessions: how long an archived…
                                                             │
● Claimed both. Starting with GN-304.                        │ ABOUT
                                                             │   claude/gn-304-6355
                                                             │   witness from main
```

## Good to know

- The rail opens by itself once, when the session takes its first card, in Claude Code's
  fullscreen layout. Elsewhere it waits for `/witness`, and the line under the prompt
  lists the cards meanwhile: `◕ GN-304 · ○ GN-433 · /witness`.
- The pull request is read with `gh` in the session's folder: at start, after a `gh pr`
  or `git push`, and at `/witness`. No `gh`, no section.
- The covered-file check sends the file's path, relative to the repository, to witness as
  a `covers` query. It never blocks the edit and never writes.
- In `claude -p`, or anywhere nobody can be asked, a Done passes through to witness as it
  would without the plugin.
- If you added witness with `claude mcp add` before, remove it (`claude mcp remove
  witness`). The plugin brings its own, and with both the agent sees every tool twice.

[witness.nu](https://witness.nu) · [docs](https://witness.nu/docs)
