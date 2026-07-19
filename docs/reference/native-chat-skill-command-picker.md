# Native Chat Skill and Command Picker

## Status

Accepted design for the first PTY-backed version of native chat skill selection.

## Problem

Native chat has a slash-command menu and a first-pass Codex skill menu, but the
experience is incomplete and inconsistent across agents:

- Codex skills appear after `$`, but skills are not offered for Claude,
  OpenClaude, or Grok.
- The current skill discovery hook calls the renderer host API directly. A pane
  owned by an SSH, WSL, or runtime environment can therefore scan the wrong
  machine and show skills the running agent cannot access.
- The current picker cannot distinguish loading, empty, and failed discovery.
- Filtering is prefix-only and source labels expose filesystem-oriented names
  instead of user-facing scopes.
- Duplicate skill names render as separate per-path rows, falsely implying a
  plain PTY token can select a specific `SKILL.md` path.
- Escape handling can discard the draft instead of dismissing the picker.

The central constraint is architectural: native chat is a composer in front of
a live agent terminal. It pastes text into the hosted TUI through the PTY; it
does not own the provider's structured composer or skill state. The text Orca
inserts must therefore be valid, native syntax for the agent already running in
that pane.

## Goal

Add a fast, keyboard-first skill and command picker to native chat that:

1. Uses each agent's real invocation syntax.
2. Combines commands and skills when an agent uses the same prefix for both.
3. Discovers only skills visible to the pane's execution host and working
   directory.
4. Makes command dispatch, command completion, and skill insertion distinct
   and predictable.
5. Handles loading, failure, empty results, duplicates, and ambiguity without
   claiming more control than the PTY transport provides.
6. Matches Orca's existing composer, popover, list-row, and keyboard behavior.

## Non-goals

- Do not create a universal `/` syntax and translate it to another token at
  send time.
- Do not expose Codex skills under both `/` and `$`.
- Do not add skill pickers for agents whose invocation grammar has not been
  verified.
- Do not replace the agent's skill manager or install/update UI.
- Do not recreate the provider's full TUI composer, command submenus, or
  argument forms.
- Do not add a second search input inside the picker. The active composer token
  is the query.
- Do not claim path-specific skill selection while native chat submits plain
  text through a PTY. Structured skill submission is a later transport change.
- Do not implement a remote SSH filesystem scanner in this change. SSH-owned
  panes show an explicit unavailable state rather than another host's results.
- Do not launch a second agent/provider process only to enumerate skills. Its
  config, environment, or home can differ from the live TUI, so its inventory
  is not proof of what that terminal session can invoke.
- Do not change mobile native chat in this change. Mobile has its own composer
  and imports `native-chat-slash-commands.ts` for its slash catalog, so ranked
  filtering and the item union live in the renderer composer state and that
  shared module's behavior stays as-is.
- Do not extend the capability table to custom agents. They cannot toggle into
  native chat today, so they keep the unsupported-agent behavior; this is a
  known limitation to revisit when custom agents host native chat.

## Decision

Use agent-native prefixes rather than an Orca-wide abstraction.

| Agent        | `/` picker                                     | `$` picker  | Skill token inserted               |
| ------------ | ---------------------------------------------- | ----------- | ---------------------------------- |
| Codex        | Commands only                                  | Skills only | `$skill-name `                     |
| Claude       | Commands and skills, grouped                   | None        | `/skill-name `                     |
| OpenClaude   | Commands and skills, grouped                   | None        | `/skill-name `                     |
| Grok         | Skills; commands once a verified catalog lands | None        | `/skill-name `                     |
| Other agents | Preserve the existing command menu             | None        | No skills until syntax is verified |

This split is the smallest correct design for a PTY-backed composer. The token
shown in the draft is exactly the token Orca sends. There is no invisible
provider translation and no duplicate Codex entry point to explain.

Claude, OpenClaude, and Grok share the presentation pattern because their
commands and skills use `/`. They do not need to share command catalogs or skill
roots. Those remain agent-specific data.

A grouped `/` surface additionally requires a command catalog verified against
that agent's CLI, because send classification and collision detection key off
the catalog. Claude and OpenClaude reuse the existing Claude catalog. Grok has
no curated catalog today — the generic `clear`/`help` fallback is not
verification — so Grok's command group is gated on adding one; until then the
Grok `/` surface ships skills-only and replaces Grok's current generic
fallback menu. Other unsupported agents keep the legacy fallback menu
unchanged.

The catalog that send classification and collision detection read is the
profile's verified catalog — empty for Grok in v1. A skills-only surface
therefore has no collisions by construction, and no Grok token classifies as
a command until its catalog lands.

"Verified" means recorded evidence, not recollection: for each supported
agent, the PR records the CLI version and date against which the prefix
grammar, argument acceptance after a skill token, and paste-then-Enter
dispatch were exercised. A grammar or catalog claim without a version behind
it does not count, and a major-version bump of an agent CLI requires
re-verification before extending its surface.

## Interaction Model

### Trigger detection

- `/` opens only when it is the first character in the draft and the caret is
  still within the unbroken first token. This mirrors command/skill syntax in
  the supported TUIs and avoids opening on paths or ordinary prose.
- `$` opens for Codex at the start of the draft or immediately after
  whitespace, with no whitespace between `$` and the caret. This allows a
  Codex skill mention to appear within a larger prompt.
- Moving the caret outside the active token, adding whitespace within it, or
  changing agents closes the picker.
- During IME composition, the picker may update visually, but Enter, Tab, and
  arrow keys must not accept or navigate suggestions until composition ends.
  Enter never submits the draft while composition is active, picker open or
  not — the composer has no composition guard today, and this change adds one
  for both paths.

The picker is derived from the text and caret, plus a small dismissed-trigger
state. Pressing Escape suppresses the picker for the current trigger
occurrence — the trigger character at its draft position — so continuing to
type inside that token does not reopen it. Suppression clears when that
trigger character is deleted, the caret leaves the token, or the pane or agent
changes. Escape never mutates the draft.

### Picker contents

Codex `/` and `$` surfaces stay separate. The `$` surface contains skill rows
only and does not need a `Skills` group heading.

Claude, OpenClaude, and Grok `/` surfaces use two headings when each group has
visible content:

1. `Commands`
2. `Skills`

Commands retain the curated order supplied by the agent command catalog.
Skills use scope priority and name ordering when the query is empty. Filtering
ranks matches within each group; it does not interleave command and skill rows.

Hide an empty group when the other group has results. If neither group matches,
show one compact empty state appropriate to the surface, such as `No matching
commands or skills` or `No matching skills`.

### Selection semantics

Commands and skills intentionally behave differently:

| Item    | Enter                                                 | Tab                                | Mouse click                             |
| ------- | ----------------------------------------------------- | ---------------------------------- | --------------------------------------- |
| Command | Dispatch `/<name>` immediately                        | Complete `/<name> ` into the draft | Complete into the draft, same as Tab    |
| Skill   | Insert the native skill token plus one trailing space | Same as Enter                      | Insert and return focus to the composer |

The trailing space after a skill is important: selecting a skill begins a
prompt; it does not submit one. The user can immediately add task-specific
instructions.

Commands keep immediate Enter dispatch because they are TUI control actions,
not normal chat turns. Mouse click completes instead of dispatching: the
catalogs include destructive controls (`/delete`, `/exit`, `/clear`), and a
stray click on a dense row list must not execute one. Commands that need
arguments use Tab completion, after which the user can type the arguments and
submit normally.

Picker dispatch and typed dispatch share one send-eligibility gate: a
disabled composer, a session-option command still writing to the pty, and
pending verified sends block both paths equally. Today the picker's dispatch
path skips the session-option check that `send` performs; consolidating them
removes that interleaving hazard.

### Send classification

Command handling — suppressed optimistic bubble, the `Ran /<name>` system
line, session-option recording, and no image attachments — must key off the
command catalog, not the `/` prefix. Today `send` treats any leading-`/` draft
as a command, which would misclassify every Claude, OpenClaude, and Grok skill
prompt. Classify at send time by the draft's first token, with case-sensitive
exact token matching:

1. The first token was inserted by a picker skill acceptance and is unedited:
   normal chat turn — optimistic bubble, attachments included, no system
   line. This origin tag makes picker-driven sends deterministic; editing the
   first token clears it. The tag is in-memory only — a draft restored from
   the draft cache classifies by the rules below.
2. Matches the active agent's command catalog: command dispatch.
3. Otherwise: suppress the optimistic bubble and, as today, attach no images
   (they would land in the runtime with no visible message), but emit no
   `Ran /<name>` system line and no session-option recording. Unknown tokens
   include prose that merely starts with a path (`/usr/bin/python is
   missing`), and `Ran` plus prose is a lie; only catalog dispatches produce
   the system line.

Classification reads exactly two stable inputs — the origin tag and the
command catalog — never discovery results, so the same draft always sends
the same way regardless of scan timing. The accepted cost: a skill token
typed by hand sends without an optimistic bubble until the transcript echoes
it. A token that is both a catalog command and a skill classifies as a
command, and because collisions render no skill row (see Duplicate Names And
Command Collisions), the origin tag can never carry one.

Acceptance replaces only the active trigger token before the caret, preserves
all text after the caret, and places the caret after the inserted space. A
pointer selection must prevent the textarea from losing focus before the
replacement is applied.

### Keyboard behavior

- `ArrowDown` and `ArrowUp` move through selectable rows and wrap at the ends.
- Navigation skips group headings and status rows. Merged duplicate-name and
  collision-annotated rows are selectable; no row is disabled.
- `Enter` and `Tab` follow the item semantics above.
- `Escape` closes the open picker and preserves the text, caret, attachments,
  and textarea focus.
- When no picker is open, existing composer Enter, Tab, history, and interrupt
  behavior remains unchanged.
- Enter and Tab never accept a heading, status, loading, or error row. When
  the picker has no selectable result, Enter falls through to the normal
  composer submit — an open picker must never block sending literal text.

Changing the query resets the selected row to the first selectable result. The
selected row scrolls into view without moving browser focus away from the
textarea.

## Data Model

Use one native-chat picker item union rather than making commands pretend to be
skills or skills pretend to be commands:

```ts
type NativeChatPickerItem =
  | {
      kind: 'command'
      id: string
      name: string
      description?: string
      /** A discovered skill shares this token; the row carries an
       *  "also a skill name - agent decides" annotation. */
      skillCollision: boolean
    }
  | {
      kind: 'skill'
      id: string
      name: string
      description: string | null
      /** Sorted by scope priority; sources[0] is the display scope and
       *  length > 1 marks a merged duplicate. */
      sources: { sourceKind: SkillSourceKind; skillFilePath: string }[]
    }
```

The item kind owns acceptance behavior. Items do not store their invocation
token: one helper derives it from the profile's prefix plus the item name, so
rendering, acceptance, and send classification cannot disagree about the
token. The prefix remains capability-table data, never inferred from the
current menu.

The capability table is one record per agent — a `NativeChatAgentProfile`
living beside `native-chat-agent-support.ts`. In v1 it carries only the data
this feature introduces: skill prefix, grouped-slash flag, and visible skill
sources. Native-chat agent knowledge already spans five agent-keyed maps
across three files, and the end state is that the supported-agent set,
transcript resolver, and command catalogs derive from these records too —
but that consolidation is a staged follow-up refactor. Bundling a rewiring
of the native-chat entry gate into a picker feature would couple unrelated
revert lines. Visibility per agent:

- Codex: Codex-owned and shared agent skills.
- Claude/OpenClaude: Claude-owned and shared agent skills.
- Grok: Grok-owned and shared agent skills.

Model source ownership as one scalar. Replace the closed `SkillProvider`
union with `owner: AgentType | null` on each discovery source — a required
field where null is explicit shared, so no source becomes shared by
omission. The picker filter is one pure check: owner is null or matches the
profile's agent family. Claude/OpenClaude aliasing lives only in the profile,
and a future agent home is a data change instead of a union edit. Ownership
lives on the source: the picker joins skills to their source by root and
reads only `owner`, so there is a single record to get right. In v1, `owner`
lands alongside the existing `providers` tags; deleting that union and
migrating the Settings skills filter is a staged follow-up so this feature's
revert never touches Settings. This fixes the labeling bug — the Grok, OpenCode,
Pi, Gemini, Antigravity, and Cursor skill homes are all tagged shared today,
which would surface, for example, Cursor-home skills in the Claude picker as
`Personal` even though the Claude CLI never reads them — and a latent
overshare: the Codex plugin cache is tagged shared today, yet a Codex plugin
skill is not invocable from another agent. Only `~/.agents/skills` and
project `.agents/skills` are truly shared.

The profile is deliberately not a provider adapter framework. It contains
only data — prefix, grouping, and visible sources in v1; catalog and
transcript family after the consolidation follow-up. Unsupported agents
continue using the existing command behavior.

## Skill Discovery And Runtime Ownership

Skill discovery must execute where the terminal's agent executes. A local path
string is not proof that the renderer host owns that path.

### Inventory boundary

Existing native-chat architectures use one of two inventory sources:

- A live provider/session API returns the commands or skills effective for its
  current working directory. This is the authoritative shape when it is
  available because it can reflect provider precedence, enabled state, and
  session configuration.
- A server-side scanner reads provider roots through the execution host's
  filesystem boundary. This is the fallback when the live provider exposes no
  reliable inventory API.

Both shapes keep discovery behind the same server or environment boundary that
owns the agent. The client keys the result by that owner and its workspace
context; the renderer only filters, ranks, and presents normalized records.

Orca v1 uses the second shape. Native chat has a common PTY and transcript
transport, but no common provider-metadata channel across the supported TUIs.
Starting a separate provider process for discovery could observe different
launch arguments, environment variables, home directories, or session state.
The existing `skills.discover` scanner therefore remains the inventory source,
but it runs inside the pane's owning runtime and resolved project host. If a
live runtime later exposes an authoritative provider inventory, adapt it behind
the same `SkillDiscoveryResult` boundary for that agent; do not add a parallel
renderer code path. Provider-inventory support is a capability decision: an
unsupported API may use the scanner, but a failed authoritative query remains
an error instead of silently changing inventory sources.

### Data flow

1. Resolve `terminalTabId` once to a discovery context containing its worktree,
   working directory, execution host/project runtime, and runtime-environment
   owner using existing store selectors. Missing context is a not-ready state,
   never permission to use the currently selected global runtime.
2. Reject an SSH execution host as unavailable before scanning. SSH targets
   are explicitly unavailable in v1 (below).
3. Call the existing `skills.discover` RPC through the resolved owner:
   - Local owner: `{ kind: 'local' }` through `callRuntimeRpc`.
   - Runtime-environment owner: that environment's `RuntimeClientTarget`.
4. Inside the owning runtime, resolve the target and execute discovery on the
   project host: the native host or the selected WSL distribution.
5. Return the normalized `SkillDiscoveryResult` to the renderer.
6. Filter by the active agent's visible sources, then deduplicate exact paths,
   merge duplicate names, classify command collisions, rank, and render.

The shared TypeScript `SkillDiscoveryTarget` already carries `cwd` and optional
project-runtime identity, but the runtime RPC validates only `cwd` and the
desktop IPC handler resolves the rest independently. Add one shared runtime
schema for the full target, parse it at both entry points, and pass it to one
`resolveSkillDiscoveryTarget` helper hoisted out of the IPC handler. The helper
returns a discriminated native-host or WSL target with host-native home and
project directories; one `discoverSkillsOnTarget` function dispatches the
scan. Two transports with divergent schemas or target resolution will drift.
Do not teach the renderer to join remote paths or run an SSH-specific
filesystem scan.

Passing a remote working directory to a local filesystem scan is invalid even
if the strings happen to look alike. For an SSH-owned pane, v1 has no way to
run discovery on the right machine: the scanner walks the local filesystem,
and the existing execution-host RPC precedent (the ai-vault `executionHostId`
pattern) only restamps results — it cannot dispatch a scan to an SSH target.
SSH panes therefore show an explicit skills-unavailable-for-this-host state
and never local results. The remote scanner is deferred work with its own
requirements: batched enumeration and frontmatter reads, host-side canonical
path identity, and a scan timeout. For a runtime-owned pane, do not fall back
to `window.api.skills.discover` on the desktop if the remote call fails;
showing a local skill as remotely available is worse than showing an error.

The desktop IPC WSL branch currently substitutes the WSL home directory for the
working directory, so it misses project roots. Resolve the project directory to
its Linux-native path and perform enumeration, frontmatter reads, realpath, and
identity comparison in the selected distribution. A Windows UNC path is a
transport representation, not the authority for WSL path semantics.

Requests are keyed by the complete discovery context: runtime owner, execution
host/project-runtime cache key, and working directory. Visibility filtering is
renderer-side, so switching agents in a pane must not rescan. If an
authoritative provider/session inventory replaces the generic scanner later,
its provider and session/config identity also become part of that key.
Discovery runs once, lazily, on the first picker open for a key, and the
result is cached for the pane's lifetime. There is no background refresh: the
design already accepts staleness at the semantic level (no filesystem
watchers; the agent owns the missing-skill response), so the UI builds no
refresh machinery the semantics do not need. A new scan happens only when the
discovery context changes or the user retries after an error. Scans time out
(10 seconds) into the error state. Ignore or abort stale
responses when any discovery-context field changes. Results stay pane-local,
but concurrent requests for one discovery-context key share a single
in-flight promise so sibling panes do not run duplicate remote scans. This
design does not require a persistent skill index or a new global cache.

### Visible scopes and labels

Discovery should mirror the selected agent's visible project, personal,
built-in, and plugin roots as closely as practical. The renderer maps source
kinds to stable product labels:

| Source kind | Picker label |
| ----------- | ------------ |
| `repo`      | `Project`    |
| `home`      | `Personal`   |
| `bundled`   | `Built-in`   |
| `plugin`    | `Plugin`     |

Do not show raw home-directory names or provider cache paths in normal picker
rows. Paths remain internal identity and diagnostics data.

When there is no query, skill scope priority is `Project`, `Personal`,
`Built-in`, then `Plugin`, followed by case-insensitive skill name. Project
scope comes first because it carries the repository-specific instructions most
likely to be relevant to the current prompt.

### Loading, error, and empty states

Discovery state is explicit: `idle`, `loading`, `ready`, or `error`.

- While loading, show the canonical `Loader2` spinner and `Loading skills...`.
  Do not briefly render `No matching skills`.
- In a combined slash picker, command rows remain available while the Skills
  group is loading or failed.
- On failure, show compact error copy and a `Retry` action. Keep technical
  details out of the row, but retain them for diagnostics.
- Show an empty state only after a successful scan returns no visible or
  matching skills.
- If the execution host is disconnected, the error state should say that
  skills could not be loaded from that host. It must not fall back to desktop
  results.
- The web preload currently converts any `skills.discover` failure into a
  successful empty result. Remove that shim; otherwise the error state is
  unreachable on web and runtime clients and every failure renders as an
  empty scan.

All visible state copy uses the existing translation system.

## Filtering, Ordering, And Identity

Filtering is case-insensitive and ranked. It considers both skill/command name
and description in this order:

1. Exact name.
2. Name prefix.
3. Word-boundary or contiguous name match.
4. Fuzzy/subsequence name match.
5. Description match.

Ties use the stable catalog order for commands and scope-plus-name order for
skills. Directory basenames may be a fallback search term when skill metadata
has a different display name, but they are not shown as a second invocation
name.

Deduplicate exact skill paths before ranking. Path identity must be computed by
the execution host so Windows casing/separators, WSL paths, and symlink
resolution follow the host that owns the file. Multiple discovery roots that
resolve to the same `SKILL.md` produce one row.

Different paths that share a display name are not the same skill. They keep
their distinct identities and are presented as one merged row (see Duplicate
Names And Command Collisions) rather than silently dropped or shown as false
per-path choices.

A skill is only offered if its name forms a valid single token — no
whitespace or control characters once the prefix is applied. A frontmatter
name like `My Skill` would insert `$My Skill `, whose PTY token is `$My`: a
silently broken invocation. Fall back to a token-safe directory basename when
the display name is unsafe, or omit the skill and keep the reason in
diagnostics.

Frontmatter names and descriptions are untrusted repository content wherever
they render: plain text only, control and bidi-override characters stripped,
length clamped. A hostile `SKILL.md` must not be able to spoof a row's
apparent name or scope.

Rendering is capped at 50 rows per group; ranked filtering makes the cap safe
because typing narrows toward the intended row. The cap bounds rendering
only — discovery results and diagnostics stay complete.

## Duplicate Names And Command Collisions

A source label is informational; a plain text token cannot bind to a path. If
two different `SKILL.md` files produce the same native invocation token, the
hosted agent — not Orca — picks which file runs, using its own precedence
rules. The user could type that token by hand and the agent would resolve it,
so the picker must not refuse what the transport plainly allows; a disabled
row only teaches users to bypass the picker.

For duplicate names:

- Merge same-token rows into one selectable row: the skill name, the
  highest-priority scope, and a compact annotation such as
  `2 sources - agent resolves`. The underlying paths stay available for
  diagnostics.
- The merged row inserts the token normally. Orca claims exactly what the PTY
  supports: the text is valid; the agent chooses the file.
- Do not render per-path rows implying that choosing `Project` over `Personal`
  selects that file, and do not auto-pick project scope, first discovery
  order, or newest file on the agent's behalf.

A skill whose token collides with a catalog command in the same `/` picker
follows the same principle: both rows would insert identical text, so a
second, disabled skill row is a false choice. Render one command row carrying
an `also a skill name - agent decides` annotation and no separate skill row.
Accepting it behaves as a command in every way, and send classification
treats the token as a command. Collision detection is best-effort: the
curated catalogs are not the agents' full command sets, so an uncataloged
command can still shadow a same-named skill inside the TUI.

Once Codex native chat submits structured input with both skill name and path,
per-path selection becomes possible. That is a transport upgrade, not part of
this PTY-backed design.

## Visual Design

Follow `docs/STYLEGUIDE.md` and extend the existing native-chat autocomplete
surface rather than introducing a new visual system.

- Anchor the picker directly above the composer field and match its width.
- Use the `popover`/`popover-foreground` surface, `border` hairline, documented
  floating elevation, and existing radius.
- Keep rows dense: a primary 13px line, a truncated 12px description, and an
  11px trailing scope label.
- Render literal native tokens in the existing mono font.
- Use a small Lucide package/box icon for skill rows. Do not add another icon
  library.
- Use the documented uppercase 11px meta style for `Commands` and `Skills`
  group headings.
- Show approximately 8-10 rows before scrolling and use `scrollbar-sleek`.
- A keyboard-selected row uses `bg-accent`/`text-accent-foreground` plus the
  documented `border-border` outline. Hover uses `bg-accent`.
- Descriptions truncate to one line. Scope metadata stays right-aligned and
  does not push the invocation name out of view.
- Do not add a picker title, search field, keyboard-hint footer, or modal
  treatment. The composer's typed token already explains and filters the
  surface.

Render the picker as plain listbox markup on the popover surface. Do not build
it on the shadcn `Command` (cmdk) primitive: cmdk owns a hidden input, its own
filtering, and its own focus and ARIA model, all of which this surface must
suppress. The textarea stays the focus, query, and active-descendant owner,
and opening the surface must not move focus or trap it like a dialog.

## Accessibility

- Expose the textarea as controlling an expanded listbox while the picker is
  open with `aria-expanded`, `aria-controls`, and `aria-activedescendant`.
- Give selectable rows stable option ids and selected state. Headings and
  status rows are not options.
- Announce loading completion, empty results, discovery failure, and
  collisions through a concise live region — on state transitions only, never
  per keystroke.
- Preserve textarea focus for pointer selection by handling pointer-down before
  the browser changes focus.
- Collision and merged-duplicate annotations must be exposed as text on their
  rows; color alone is insufficient.
- Keyboard behavior and shortcut labels must remain platform-neutral. This
  feature adds no hardcoded Meta-only shortcut.

## Observability

Extend the existing native-chat telemetry rather than adding a new system:
picker opens and acceptances by item kind and agent, send-classification
outcome counts, and discovery terminal states (ready, error, timeout,
unavailable) by execution-host kind. Record no paths, skill names, or query
text. These signals answer the post-ship questions that matter: is the picker
used, does classification misfire, and does discovery fail in the field.

## Implementation Shape

Keep the change within the current native-chat autocomplete architecture:

1. Introduce the per-agent `NativeChatAgentProfile` beside
   `native-chat-agent-support.ts` carrying only the new data this feature
   needs: skill prefix, grouped-slash flag, and visible skill sources. The
   supported-agent set, transcript resolver, and command catalog map stay
   untouched in v1; their consolidation into the profile is a follow-up with
   its own revert line, so a picker regression can never break native-chat
   entry.
2. Extend `use-native-chat-skills.ts` to return discovery status, error, retry,
   and runtime-owned results for the supported agents, with lazy start,
   owner-plus-execution-host-plus-cwd request keying and in-flight sharing,
   and the scan timeout.
3. Add per-source `owner: AgentType | null` alongside the existing
   `SkillProvider` tags; the picker reads only `owner`, and deleting the
   union plus migrating the Settings skills filter is a follow-up. Extend the
   runtime RPC target for execution-host-aware scans behind one target schema
   and resolution helper shared with the desktop IPC handler; rework the IPC
   WSL branch to scan the project directory; remove the web preload's
   catch-to-empty shim.
4. Refactor `native-chat-composer-state.ts` around the command/skill item
   union, ranked filtering, grouping, token replacement, duplicate merging,
   and collision annotation. Ranking stays in this renderer module;
   `native-chat-slash-commands.ts` keeps its current behavior because mobile
   imports it.
5. Consolidate the slash and skill list presentation in
   `NativeChatAutocompleteMenus.tsx` while retaining agent-specific group and
   prefix behavior, memoized so composer keystrokes re-render only the
   composer and menu subtrees, never the transcript list.
6. Keep `NativeChatComposer.tsx` (with `use-native-chat-composer-keydown.ts`
   and `NativeChatComposerField.tsx`) responsible for draft/caret state, PTY
   command dispatch, Enter fall-through, occurrence-keyed Escape suppression,
   origin-tagged catalog-based send classification replacing the `/`-prefix
   check, the composition guard on submit, pointer focus preservation, and
   the existing switch-to-terminal callback.
7. Add a Grok command catalog to `native-chat-slash-commands.ts` verified
   against the Grok CLI, or ship the Grok surface skills-only until one lands.

This requires no generic provider adapter, global command registry rewrite,
new persistence, or separate picker framework.

## Edge Cases

- A query can match commands while remote skill discovery is still loading;
  the command group remains interactive.
- A skill can be added or removed after discovery. PTY submission remains
  plain text, so the agent owns the resulting missing-skill response; the
  cache lasts the pane's lifetime and v1 adds no watchers or background
  refresh.
- Changing panes, agents, execution hosts, or worktrees while a scan is pending
  must not flash stale rows from the previous owner.
- Broken or unreadable skill files are omitted by discovery. A failed whole
  scan uses the error state instead of an empty state.
- Symlinked roots that resolve to the same skill file render once.
- Different skill files with the same name merge into one selectable row even
  when one is project-scoped; the agent resolves the file.
- A picker-accepted skill prompt is a chat turn even though it starts with
  `/` or `$`: it keeps its optimistic bubble and image attachments, unlike a
  command dispatch. A hand-typed skill token deliberately takes the
  conservative unknown-token path.
- Prose whose first token merely looks like a command, such as
  `/usr/bin/python is missing`, sends without an optimistic bubble but produces
  no misleading `Ran` system line.
- A skill/command name longer than the row width truncates visually but inserts
  the full native token.
- Leading whitespace does not open `/`; this preserves the supported TUI rule
  that commands and slash skills begin the input.
- `$` tokens in prose or shell text (`pay $50`, `echo $PATH`) do open the
  Codex picker when they start a whitespace-delimited token. The cost is
  bounded: no match means no selectable row, Enter still submits the draft,
  and Escape suppresses that occurrence without reopening as typing continues.
- An SSH-owned pane shows the explicit unavailable state (v1 has no remote
  scanner); a disconnected runtime owner shows a recoverable error. Neither
  ever shows desktop skills.
- Windows and WSL discovery uses runtime-native path identity; the renderer
  does not normalize paths as if they were POSIX.
- The hosted TUI may open its own suggestion popup on pasted text. Orca always
  sends complete tokens through the existing paste-then-delayed-Enter
  transport; whether Enter then dispatches the literal line — including a
  token that is a strict prefix of another command or skill name — is an
  empirical per-agent property covered by manual validation, not an assumption.

## Test Plan

### Pure state tests

- Agent matrix: Codex separates `/` commands and `$` skills; Claude,
  OpenClaude, and Grok group commands and skills under `/`; other agents do not
  gain skills.
- Trigger detection at draft start, after whitespace for Codex `$`, at moved
  carets, after inserted whitespace, and during IME composition.
- Ranked matching by exact name, prefix, fuzzy name, and description, with
  stable group ordering.
- Empty-query ordering by command catalog and skill scope.
- Exact-path deduplication and same-name duplicate merging across different
  paths.
- Skill/command token collision renders one annotated command row and no
  separate skill row.
- Send classification reads only the origin tag and the catalog:
  picker-accepted skill tokens send as chat turns, catalog matches dispatch
  as commands (case-sensitive exact token), and everything else — including
  hand-typed skill tokens — suppresses the bubble without a `Ran` line.
- Token-unsafe skill names fall back to a safe basename or are omitted.
- Skill replacement preserves surrounding text and adds one trailing space.
- Command Enter dispatch text and Tab completion text remain distinct.

### Discovery tests

- Local, Windows host, WSL, and runtime-environment panes call
  `skills.discover` through the correct owner and scan the correct cwd; SSH
  panes get the unavailable state without any scan.
- Agent visibility filtering includes shared roots but excludes another
  agent's home and another agent's plugin cache.
- Stale responses are ignored after cwd, pane, or owner changes; switching
  project runtime or execution host also invalidates the request, while
  switching agents refilters without rescanning.
- Lazy start on first picker open, exactly one scan per discovery context,
  and the scan timeout landing in the error state.
- Concurrent panes on one discovery-context key share a single in-flight scan.
- Loading, success-empty, error, retry, and disconnected-host states remain
  distinct.
- A remote failure never falls back to host discovery.
- Equivalent symlink/canonical paths deduplicate on the owning host.

### Component and integration tests

- Combined `/` menus render `Commands` and `Skills` headings only when needed.
- Codex `$` renders a skill-only surface without a redundant heading.
- Arrow navigation skips headings and status rows and keeps the selected row
  visible.
- Escape dismisses the picker without clearing text or attachments; editing the
  token can reopen it.
- Enter dispatches a command without an optimistic chat bubble.
- Tab and mouse click complete a command without dispatching it.
- Enter, Tab, and click insert a skill token without submitting the prompt;
  sending the finished skill prompt renders an optimistic bubble, keeps
  attachments, and emits no `Ran /<name>` line.
- With a picker open but no selectable result, Enter submits the draft.
- Picker command dispatch is blocked by the same gates as typed sends,
  including a session-option command still writing to the pty.
- Untrusted frontmatter renders sanitized (control and bidi-override
  characters stripped, length clamped) and the 50-row render cap applies.
- Pointer selection preserves textarea focus and restores the caret correctly.
- Loading does not flash the empty state.
- A merged duplicate row inserts its token with the multi-source annotation
  visible; a collision renders one annotated command row and no separate
  skill row.
- Enter during IME composition neither accepts a suggestion nor submits the
  draft.
- Composer keystrokes with the picker open re-render only the composer and
  menu subtrees, never the transcript list.
- ARIA ownership, active descendant, selected state, live-region copy, and IME
  behavior are covered.

### Manual validation

- Validate Codex, Claude/OpenClaude, and Grok in native chat against their
  hosted TUIs, recording each CLI version per the verification rule in
  Decision.
- Confirm per agent that paste-then-Enter dispatches the literal token even
  when the hosted TUI opens its own suggestion popup, including a token that
  is a strict prefix of another command or skill name.
- Validate light and dark themes, narrow composer widths, long descriptions,
  8-10+ results, and mouse/keyboard selection.
- Validate a local worktree, Windows/WSL worktree, and saved runtime
  environment with different installed skill sets to prove there is no
  cross-host leakage, and confirm an SSH worktree shows the unavailable state.
- Capture screenshots for the combined picker, Codex `$` picker, loading,
  error, empty, merged-duplicate, and command-collision states for the PR
  conversation; do not commit those screenshots.

## Acceptance Criteria

- Typing `$` in Codex native chat opens a skill-only picker; Codex skills do not
  also appear under `/`.
- Typing `/` in Claude, OpenClaude, or Grok native chat shows grouped commands
  and skills using that agent's visible skill roots.
- Selecting a skill inserts its native token and a trailing space without
  sending the prompt; the sent skill prompt is a normal chat turn with an
  optimistic bubble and its attachments.
- Enter on a command dispatches immediately; Tab and mouse click complete it
  into the draft.
- Escape closes the picker, preserves the draft, caret, and attachments, and
  stays dismissed while typing continues in the same trigger occurrence.
- With a picker open but no selectable result, Enter submits the draft
  normally.
- Skill results always come from the pane's actual local, WSL, or runtime
  execution host and cwd; SSH-owned panes show an explicit unavailable state
  and never local results.
- Loading, empty, and error states cannot be mistaken for one another,
  including on web and runtime clients.
- Exact duplicate paths render once. Different paths with the same invocation
  name merge into one selectable row that says the agent resolves the file; no
  per-path selection is claimed over PTY.
- Rows use product scope labels (`Project`, `Personal`, `Built-in`, `Plugin`),
  ranked name/description filtering, and the documented Orca popover/list
  styling.
- Unsupported agents retain current command behavior and do not receive an
  unverified skill picker.

## Rollout

1. Add the pure capability, item, filtering, token replacement, deduplication,
   duplicate-merging, collision, and send-classification tests.
2. Route skill discovery through the pane owner and add explicit discovery
   states, fixing Codex host correctness and the SSH unavailable state first.
3. Consolidate the menu presentation and fix Escape/focus/accessibility
   behavior for the existing Codex surfaces.
4. Add Claude/OpenClaude visibility metadata and grouped `/` menus; add Grok
   once its command catalog and skill grammar are verified against the Grok
   CLI.
5. Run targeted tests, typecheck, lint, and Electron validation across local
   and remote execution hosts.

No separate feature flag is required. Exposure is already limited to native
chat and the explicit supported-agent capability table. Rollback is a plain
revert: discovery stays in-memory, no persisted formats change, native chat
itself remains behind the experimental setting, and the staged follow-ups
keep Settings and the native-chat entry gate out of this feature's revert
line.

## Deferred Work

- Submit Codex skills as structured `{ name, path }` input through a native
  protocol so duplicate names can be selected safely.
- Replace curated command catalogs if an agent exposes a reliable live command
  inventory.
- Prefer a live provider/session skill inventory when the owning runtime can
  prove it belongs to the hosted agent context; preserve provider scope,
  enabled state, and path metadata behind `SkillDiscoveryResult`, with the
  runtime scanner as the unsupported-capability fallback rather than a
  failure-to-empty fallback.
- Implement the remote SSH skill scanner — batched root enumeration and
  frontmatter reads over the SSH transport, host-side canonical path identity,
  and a scan timeout — then lift the SSH unavailable state.
- Add other agents only after verifying their trigger grammar, visible skill
  roots, and PTY fallback behavior.
- Consolidate the supported-agent set, transcript resolver, and command
  catalogs into `NativeChatAgentProfile` once the picker has soaked.
- Delete the `SkillProvider` union and migrate the Settings skills filter to
  per-source `owner`.
- Extend the capability table to custom agents once they can host native chat.
- Reuse the shared pure picker state on mobile after desktop behavior and
  runtime routing are proven.
