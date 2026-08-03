# Agent Fleet Control Room

Third-generation mocks (after `agent-fleet-concepts/`, `agent-fleet-refined/`,
`agent-viewer-alternatives/`), built from a research pass over infrastructure fleet
dashboards (Nomad topology, kube-ops-view, Kiali, Datadog host maps, Vizceral, Weave
Scope, Grafana, Honeycomb), AI-agent products (Claude Code Agent View, Devin Command
Center, LangChain Agent Inbox, Cursor/Copilot/Codex session lists), and control-room
prior art (ATC flight strips, NASA-STD-3001 / Apollo caution-and-warning, ISA-18.2
alarm management, RTS conventions).

## Tenets

1. **Whole fleet always accounted for** — every agent has a representation from
   dispatch to explicit dismissal; an accounting line proves it ("104 of 246 agents").
2. **State is preattentive** — color, glyph shape, and motion rate communicate before
   any text is read. Reading is progressive: hover, then click.
3. **One step from seeing to responding, in place** — answer a question, grant a
   permission, or review a diff without leaving the board; attaching a terminal is the
   escalation, never the prerequisite.
4. **Spatial stability** — position is a deterministic function of (project, worktree,
   start time). Nothing re-sorts by a live metric; users build spatial memory.
5. **Nothing falls through the cracks** — finished work latches into TO REVIEW until
   explicitly reviewed (ISA-18.2 `RTNUN`; Apollo: acknowledging silences, never clears).
6. **The actionable unit is a decision** — six agents blocked on the same permission
   render as one card; one response unblocks all of them.
7. **Degrades gracefully 5 → 150+** — labels hide before agents do; folds always say
   what they hid; failures and open PRs never fold.
8. **Liveness is the aesthetic** — motion means "not settled": fast blink = needs you,
   slow pulse = finished-unreviewed, still = quiet fleet. Working agents get at most a
   dim slow spinner. A motionless board is the good outcome, not a dead one.

## Key research findings baked in

- Every serious topology tool abandoned force-directed layout (Kiali deleted its
  physics layouts; Nomad never had one). Position here is **pure containment** —
  project → worktree → agent — with **on-demand lineage edges** drawn only for the
  selected agent (Nomad's sibling-highlight mechanic).
- **Grayscale-normal chromatic budget** (ISA-101 / High-Performance HMI, and Orca's own
  styleguide): chrome is monochrome, saturated hue appears only on states that need a
  human. Working is deliberately dim.
- **Color never rides alone**: yellow-500 (working) vs amber-500 (needs input) measures
  ΔE 5.3 for normal vision and 2.5 for deuteranopia (validated) — every state pairs its
  hue with a distinct glyph shape, and liveness (process alive / exited / loop-sleeping)
  is a separate channel, per Claude Code Agent View.
- **Three-rate annunciation** (ISA-18.1 Sequence R): fast border-blink = unacknowledged
  needs-you; slow pulse = returned-to-normal-but-unreviewed; steady = acknowledged.
  Blink the border between neutral and priority color — never fill or text — and stop
  the moment a human acknowledges.
- **Self-clearing count-and-cycle badges** (StarCraft's idle-worker button): the badge
  counts neglected items, pressing it cycles through them, and it vanishes when the
  category empties.
- **Coalesced decisions** (LangChain Agent Inbox affordances + ISA-18.2 alarm
  rationalization + a Honeycomb-BubbleUp commonality line): no shipping product does
  this; it is the feature that makes 150 agents supervisable.
- Datadog's refresh rule: **auto-refresh is suppressed while the user interacts.**
  Kiali's loudest complaint was refresh resetting zoom — never reset the viewport.

## The mocks

- **`fleet-map.html`** — the observability flagship. Nomad-style containment map with
  k9s-Pulse dials, hover-only numbers, split-right respond-in-place panel, on-demand
  lineage edges, filter-by-desaturation (matches keep their position; nothing reflows).
- **`fleet-strips.html`** — the intervention flagship. ATC strip bays as states
  (NEEDS YOU / WORKING / TO REVIEW / DONE), coalesced decision cards first, questions
  verbatim on blocked strips, peek-with-numbered-replies, cocked-strip pinning, latched
  review bay, DONE folded with "PRs and failures never fold".
- **`mission-control.html`** — the hybrid: containment map (left) + intervention rail
  (right) + dials, with map↔rail selection linkage showing they are one surface.
- **`fleet-hexmap.html`** — the minimal/modern bar (Datadog host-map lineage): a packed
  hexagon field with zero text — quiet dark glass, 11 glowing cells, words only in the
  hover tooltip and a slide-in respond panel.
- **`fleet-terminal-wall.html`** — "lots of little agents doing work": a video wall of
  104 miniature terminals. Working tiles genuinely type and scroll (staggered,
  deterministic content, paced by timers, reduced-motion gated); needs-you tiles end on
  the question or permission line; the settled fleet is a silent micro-tile strip.
- **`fleet-inbox.html`** — the calm single-column take: approval cards, top question
  expanded with choice pills, the rest one line each, remaining fleet as three grouped
  rows. (Feedback: right idea, execution too literally iOS.)
- **`fleet-triage.html`** — the daily driver: the same "what needs me?" spine in a
  desktop-native split view (Linear-inbox shape). 420px list — Needs you / Working /
  Ready to review / Done with counts — and a detail pane where the selected item carries
  its full context and actions: Allow / Allow-for-project / Deny on a coalesced
  permission, numbered answers on a question, live tail, arrow-key navigation.
  Hierarchy by size and spacing; the only color is a 6px state dot per row.
- **`fleet-glass.html`** — the answer to "the board is boring / late-90s task list":
  board's structure rendered as living material. Same worktree-card containment and
  reading order, but: neutral-gradient glass cards with inner highlights and soft
  depth, agents as glowing ORBS (words exist only on needs-you ask-lines), a
  typographic stat band (34px numerals, amber glow on the needs-you count),
  needs-you/failed cards bloom with edge light, working orbs breathe, hover-lift,
  floating glass respond panel. Depth comes from neutral gradients and glow only —
  no new hues; the elevated-surface treatment is the one deliberate extension
  beyond the app's flat tokens.
- **`fleet-space.html`** — glass set free: the same glass worktree cards on an OPEN
  pan/zoom field (no rings, no containers). Deterministic masonry clusters per project
  with hash jitter for an organic first layout; every card individually draggable with
  positions persisted to localStorage (drag the furniture — agents stay orbs inside);
  floating project labels; scroll-zoom toward cursor; Fit / Reset layout; the glass
  respond panel floats over the field.
- **`fleet-board.html`** — the correction after fleet-tiles ("impossible to tell where
  one worktree ends"): the WORKTREE CARD is the unit of the design. Projects as
  eyebrow sections, worktree cards in a strict reading-order grid (needs-you first,
  then alphabetical), agents as quiet rows inside, ask-lines on a sub-rail, styled to
  Orca's real kanban-card idiom (12px/11px, tabular-nums, hairlines). Zoom is DENSITY,
  not 2D scatter: Compact (whole fleet on one screen — header slabs + dot clusters) /
  Normal / Detail (inline terminal tails), via segmented control, ⌃scroll, or `?d=`.
  Respond panel insets the board instead of covering it. Captures:
  `fleet-board-compact.png` / `fleet-board.png` / `fleet-board-detail.png`.
- **`fleet-tiles.html`** — the semantic-zoom tile canvas (rounded tiles, one primitive,
  three altitudes): squircle chip at far zoom → name/state/PR card at mid → live typing
  terminal up close. Repo islands and worktree groups are draggable (positions persist
  to localStorage; agents auto-place inside — drag the furniture, not the people), with
  a minimap (click/drag to move the viewport), F cycling needs-you, and the shared
  respond-in-place panel. Band captures: `fleet-tiles-far.png` / `fleet-tiles.png` (mid)
  / `fleet-tiles-near.png`, via `capture-tiles-bands.mjs`.
- **`fleet-canvas.html`** — the revival of Brennan's April-2026 movable concentric
  dashboard (branch `brennanb2025/orca-agent-status-dashboard-movable-ui`, tip
  `6416b2c3e3`): an infinite pan/zoom SVG canvas of repo systems — core, orbit rings,
  worktree clusters, log-duration agent nodes — with deterministic hash-derived
  placement, zoom-as-altitude labels (repo names always; worktree labels at mid-zoom
  with overlap thinning; questions beside amber nodes up close), on-demand cross-system
  lineage arcs, and the hexmap's slide-in respond panel. Prior art studied: OpenCove
  (DeadWaveWave) for the infinite-canvas + minimap pattern.

## Data

All three render the **real captured fleet** from
`../agent-viewer-alternatives/actual-agent-activity.js` (104 agents, 59 worktrees,
snapshot of 246-agent / 106-worktree fleet). The capture only distinguishes
working/done, so `fleet-state-synthesis.js` deterministically synthesizes (FNV-1a over
agent id — identical every reload) the states the CLI doesn't report yet: 3 questions,
6 permission requests coalesced into 2 decisions, 2 failures, a 14-item review latch,
liveness, PRs, pins, and display-project grouping (`orca` / `orca-mobile` /
`automation`).

`control-room-tokens.css` copies the dark-theme values from
`src/renderer/src/assets/main.css` and the agent-state colors from `AgentStateDot.tsx`;
no new color values were invented.

## Viewing

Open any of the three HTML files directly (`file://` works), or serve the repo root:
`python3 -m http.server 4173`. Screenshots were captured at 1600×1000 via
`npx playwright screenshot`.
