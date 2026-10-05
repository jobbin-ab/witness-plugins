# witness-plugins

The witness plugin for Claude Code, and its marketplace of one. This repository is the
plugin's source and what people install: there is no other copy. What the plugin is for,
and why each part is shaped as it is, is `docs/mod-concept.md` in the witness repository
(`robingedda/witness`).

```
  .claude-plugin/marketplace.json
  README.md                     the public README
  LICENSE                       MIT, Jobbin AB; the public repository's
  plugins/witness/
    LICENSE                     the same, for the plugin on its own
    .claude-plugin/plugin.json
    .claude-plugin/icon.png     the directory's icon, witness's app icon; fixed
                                once the plugin is first submitted
    .mcp.json                   the witness MCP server, https://witness.nu/mcp, as "witness"
    hooks/hooks.json            names the hooks module
    hooks/register.tsx          every hook, every `$` call and the rail's tree: each
                                `$` use a literal `$.noun.method(...)`, each hook its own
                                `on("event", ...)` line, and `$` passed whole only to a
                                function declared at the top of this file (never to the
                                state library's `read` or `update`), so the engine and
                                the plugin directory can follow it
    hooks/calls.ts              tool names and result parsing
    hooks/done.ts               which writes put a Done in a person's name; the question
                                and the refusal
    hooks/cards.ts              the session's cards, from results only
    hooks/rail.ts               the rail's rows, the hint tail, the pull request parse,
                                artifacts and the card link
    hooks/glyphs.ts             the status ring: terminal cells, ANSI colours, the SVG
    hooks/labels.ts             the page's status labels (the SVG's alt text)
    hooks/covers.ts             the covered-file note
    types/index.d.ts            the `$.state` contract
    tests/witness.test.ts       `claude plugin test`
```

## What it does

1. **A Done in your name.** A witness write that sends `status: done` with `verifiedBy`
   (`update_card`, any item of `update_cards`, `create_card`) waits on the engine's own
   question dialog, which carries the name the write carries:
   `GN-412 goes to Done, verified by Robin. Did you watch it work?`, with
   `I watched it work` and `Not yet`. The first passes the call unchanged. "Not yet"
   refuses it with "The person says they have not watched it work…"; closing the dialog
   or typing anything else refuses it with "The person did not confirm they watched it
   work…". Both tell the agent to put what it ran in `verification` and send
   `status: verify`. With no surface to ask on, the call passes and the server's own guard
   stands.
2. **The covered file.** When Edit, Write, MultiEdit or NotebookEdit first changes a path
   in a session, the mod calls `witness_list_cards` with `covers` on each project the
   session has read (any call that carried a read proof), and when a card covers it, adds
   one note to the edit's result as `context`, which the model reads right after that
   result. The lookup starts before the edit and waits at most two seconds past it. Never
   blocks, never writes; silent when nothing covers it, on error or timeout, before the
   session has read a project, and for a path the agent already asked `covers` about.

3. **The session rail.** A `Pane` with id and title `witness`: PULL REQUEST (title and
   `#365 · Draft`, from `gh pr view --json number,title,url,state,isDraft,baseRefName`),
   CARD or CARDS (glyph, id, title; from the session's own `claim_card`, `create_card`,
   `update_card`, `update_cards` and `release_card` results), ARTIFACT or ARTIFACTS (the
   Artifact tool's own publish results), ABOUT (the branch, and `<repository> from <base>`
   with the base from the pull request only). A section with nothing in it is not drawn.
   Every row one line, cut by cells (wide characters take two) at the body width with `…`
   as the last cell; docked, the mod draws a one-cell gutter each side, so the `…` sits
   under the close mark. Docked it asks for 44 columns and nothing folds. Inline it asks
   for its lines with the folds that fit 14, and draws to the height the engine gave
   (`scroll.bodyRows`): CARDS folds first to as many rows as fit, at least one, and
   `n more` (a fold that saves no row is not made), then ARTIFACTS; PULL REQUEST and ABOUT
   never. A card or artifact that lands while it sits inline asks for the new height with
   another open.
   Card rows link to `<page>#/cards/<id>`. The page comes once per server and project,
   from the `resource_link` named `page` that `agent_md` answers with after the document
   (the engine hands a hook that block flattened to `[Resource link: page] <uri>`; a real
   block is read too), and is kept only when it ends in `/r/<projectId>`. A card links
   to its own server's page, so two servers holding the same project id never cross-link.
   A session that writes with a proof but never called `agent_md` itself (resumed, or past
   a compaction) has the mod call `agent_md` once for that project, waiting at most two
   seconds and silent on failure; until a page is known the row draws without a link. The glyph is a terminal
   cell with ANSI colour for the four owed statuses (`hooks/glyphs.ts`), and the page's
   own SVG on desktop and VS Code.
   - Empty states: "witness is not connected. Sign in with /mcp." stands where CARDS
     would, whatever else is drawn. Connected with no card, nothing is said unless the
     rail has nothing else to draw: then `No card yet.` / `The agent's first card appears
     here.`
   - `/witness` opens it at once from what is held, at any width, and closes it when open;
     the pull request is read after, never waited on. In the fullscreen layout, desktop
     and VS Code it opens by itself once, when the session takes its first card (the
     layout is learnt from the hint line; still unknown then, it does not open); outside
     it, it waits for `/witness`. Close it and it stays closed until the next `/witness`.
     With no surface it never opens, and no `gh` or `git` runs.
   - On the terminal, while cards are held and the rail is not placed, the hint line under
     the prompt gains `◕ GN-304 · ○ GN-433 · /witness` (the engine joins it with ` · `),
     fitted to the row by dropping `/witness` and then the last card.
   - The pull request and branch (`HEAD`, a detached head, is no branch) are read at
     session start, after a Bash call holding `gh pr` or `git push`, and at `/witness`.
     Never polled.
A witness tool is recognised by name, `mcp__<any server>__witness_<tool>`, so the mod works
whether witness is connected as this plugin's server (`plugin_witness_witness`), as
`witness`, or as `witness-dev`.

## Rules

- **`hooks/register.tsx` is the only file that touches `$`.** Every use is a literal
  `$.noun.method(...)`; each hook is its own `on("event", ...)` line; `$` is passed whole
  only to a function declared at the top of that file, never to an imported one (the state
  library's `read` and `update` included). The name `h` (and `Fragment`) is the JSX factory
  and nothing else: no parameter, variable or import may take it. The plugin directory's
  validator refuses anything else, and it is stricter than `claude plugin validate`.
- **Statuses are a copy.** `hooks/labels.ts` and `hooks/glyphs.ts` carry every status key
  witness has, retired ones included, as `src/vocabulary.ts` in the witness repository
  defines them. Nothing checks the copy; when witness adds, renames or retires a status,
  both files change here in a new version.
- **Every release bumps `version`** in `plugins/witness/.claude-plugin/plugin.json`;
  installed copies only update when it changes.
- **The public README says what the plugin reads, runs and sends.** A change to any of
  those changes the README section "What the plugin does on your machine and network" in
  the same commit.

## Working on it

```
claude plugin validate plugins/witness
claude plugin validate .
claude plugin test plugins/witness
CLAUDE_CODE_NO_FLICKER=1 claude --plugin-dir plugins/witness   # the fullscreen layout, where the rail docks
```

Type-check with the `tsconfig.json` from the header of the engine's
`types/claude-code.d.ts` (the plugin-authoring skill names where it is), kept outside the
plugin folder. Once the engine has loaded the plugin from disk it lays its declarations
in `.claude-plugin/types/` with a `tsconfig.json` beside the manifest, and
`tsc -p plugins/witness` works; both are the machine's, and `.gitignore` leaves them out.

To try the marketplace from a checkout: `claude plugin marketplace add .` and
`claude plugin install witness`; edits reach a session at `/reload-plugins`.

## Releasing

Bump `version`, open a pull request, and merge it once CI is green. `main` is what people
install, and what the plugin directory validates. Re-validate there after each release.
