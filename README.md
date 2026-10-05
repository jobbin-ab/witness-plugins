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

## What the plugin does on your machine and network

**What it sends.** Its own calls go only to witness, through the MCP connection your
session's witness tools use. It makes two calls there without the agent asking:

- `witness_list_cards` with `covers`, the first time the agent edits a file in a session,
  once the session has read a project. It sends the file's path relative to the
  repository, with the project id and read proof the agent's own witness calls used.
- `witness_agent_md`, once per project, when a card arrives before the session knows the
  project's page (a resumed session, or one past a compaction). It sends the project id,
  and keeps the page address for the rail's links.

Nothing else leaves your machine: no file contents, no command output, nothing else from
the conversation.

**What it runs.** Two fixed commands in the session's folder, for the rail's pull request
and branch: `git rev-parse --abbrev-ref HEAD` and
`gh pr view --json number,title,url,state,isDraft,baseRefName`, which asks GitHub for the
branch's pull request with your own `gh` login. They run at session start, after a Bash call holding `gh pr` or
`git push`, and at `/witness`. Never polled, and never where nothing can show the rail
(`claude -p`). No `gh`, no pull request section.

**What it reads.** These tool calls, keeping what the rail and the questions need for the
session:

- witness tools: input and result, for the cards the session holds (id, title, status),
  each project's read proof, and its page address. A write that puts a card Done with
  `verifiedBy` waits for your answer.
- Bash: the command's text, only to see whether it holds `gh pr` or `git push`.
- Artifact: a publish's result, for its URL and title.
- Edit, Write, MultiEdit and NotebookEdit: the file's path, for the covers check. A
  covering card is added as a note to the edit's result, which waits at most two seconds
for the answer.

It changes no tool's input, and the only call it stops is a Done you did not confirm.
`/witness` is the one command it answers: it opens or closes the rail, and opening reads
the pull request and branch as above.

## Good to know

- The rail opens by itself once, when the session takes its first card, in Claude Code's
  fullscreen layout. Elsewhere it waits for `/witness`, and the line under the prompt
  lists the cards meanwhile: `◕ GN-304 · ○ GN-433 · /witness`.
- In `claude -p`, or anywhere nobody can be asked, a Done passes through to witness as it
  would without the plugin.
- If you added witness with `claude mcp add` before, remove it (`claude mcp remove
  witness`). The plugin brings its own, and with both the agent sees every tool twice.

[witness.nu](https://witness.nu) · [docs](https://witness.nu/docs)
