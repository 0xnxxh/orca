# Survey: Agent-product fleet/canvas UIs for Orca fleet-canvas inspiration

**Task:** `task_e78c9946452e` / dispatch `ctx_f109c91443ca`  
**Run objective:** Survey current agent-product fleet/canvas UIs (X + web) for Orca fleet-canvas inspiration  
**Task title as dispatched:** `shape probe stripped` (abbreviated; coordinator intended a full research brief that failed to land due to orchestration identity issues)  
**Mode:** Research-only (web + X). No worktree file modifications.  
**Date:** 2026-08-01  
**Author:** Grok worker terminal `term_5f390873-6cba-4a53-a793-dfe5a439661b`

---

## 1. Executive summary

The 2026 coding-agent market has split the **control plane** (where you see and steer many agents) away from the **editor** as the primary surface. Products cluster into five UI archetypes:

| Archetype | Core metaphor | Best for | Exemplars |
|-----------|---------------|----------|-----------|
| **A. Infinite canvas / spatial tiles** | Pan-zoom room of terminals, files, panes | Spatial memory, multi-machine, ad-hoc arrangement | Collaborator, 49Agents, Cate |
| **B. Containment / topology map** | Project → worktree → agent nodes | Fleet awareness at 50–150+ agents | Orca rings/map mocks; infra lineage (Nomad, Datadog host map) |
| **C. Intervention / decision inbox** | “What needs me?” + respond-in-place | Human bottleneck (permissions, questions, review) | LangChain Agent Inbox pattern; Orca strips/triage; Mission Control dashboards |
| **D. Work-orchestration board** | Kanban / issue → agent workspace → diff review | Parallel features with explicit PR lifecycle | Vibe Kanban, Conductor, Weave Fleet |
| **E. Agent-first app shell** | Sessions list + agent as primary chrome | Daily driver multi-agent IDE | Cursor Glass / Agents Window, OpenHands Agent Canvas |

**Orca’s existing control-room tenets already outpace most shipping products** on scale (accounting line, coalesced decisions, latched review, spatial stability). The gap in the market is not “another canvas for terminals” — it is **fleet-scale awareness + decision-centric intervention**, with canvas/topology as the *awareness layer* and inbox/strips as the *action layer*.

---

## 2. Provenance note (task shape)

- Dispatched task spec literally: **“shape probe stripped”** (coordinator hit `legacy_read_only` / env-strip path while creating the task; title was truncated).
- Run objective (authoritative): *Survey current agent-product fleet/canvas UIs (X + web) for Orca fleet-canvas inspiration*.
- Coordinator tail showed intent to mail a full brief: research-only, web + X, do not modify worktree files, survey agent-orchestration product UIs.
- Parent design context in `albacore`: multi-gen mocks (`agent-fleet-concepts` → `agent-fleet-refined` → `agent-viewer-alternatives` → `agent-fleet-control-room`) including Iron Man–style **Fleet Rings** (project → worktree → agent).
- Worker could not deliver lifecycle heartbeats (`legacy_read_only` on `send`/`check`/`ask` mutations) but could read `task-list` / `dispatch-show` / `run-show`.

---

## 3. Product inventory (web + X, 2025–2026)

### 3.1 Infinite canvas / spatial tile IDEs

#### Collaborator (`collabs-inc/collab-public`, Electron)
- **UI:** Infinite pan-zoom canvas + left navigator (workspaces, file tree). Double-click empty canvas → terminal tile; drag files → note/code/image tiles.
- **Agent model:** Terminals *are* the agent surface (Claude Code, Codex, Gemini CLI, any TTY agent). Not a special agent graph.
- **Persistence:** `~/.collaborator/` JSON (tiles, viewport, workspaces). Local-first, no accounts.
- **Stack signals:** Electron + xterm.js + Monaco + D3 (force graph available).
- **Takeaways for Orca:** Spatial freestyle is great for 5–15 agents; **force-directed / free placement does not scale** to Orca’s 100–400 terminal fleets. Collaborator proves the *tile + hover terminal* interaction people love; Orca rings already formalize placement via containment.

#### 49Agents (49agents.com / GitHub 49Agents)
- **Pitch:** “Hard to manage 15 agent tabs? … multi-💻, 📱-friendly ✨ 2D canvas.”
- **UI patterns:** Infinite canvas of terminals, git graphs, notes, resource monitors; multi-machine without SSH; broadcast input; issue board tags; resume sessions; mobile check-in.
- **X signal:** Positioning as the IDE becoming *one view among many* (tickets, PRs, agents, specs co-located).
- **Takeaways:** Multi-machine canvas + resource gauges map cleanly to Orca’s local/SSH/WSL host model. Broadcast-input and “tag terminal with issue” are cheap wins. Free tier caps (6 terminals) show they still optimize for dozens, not hundreds.

#### Cate (community / Show HN lineage)
- Open-source canvas IDE placing editors, terminals, browsers, docs, git worktrees on one surface — same family as Collaborator/49Agents.

### 3.2 Agent-first product shells (not freeform canvas)

#### OpenHands Agent Canvas (openhands.dev/product/canvas, `@openhands/agent-canvas`)
- **Positioning:** “From prompting to process” — browser/desktop control surface for agentic work; **parallel agents in isolated git worktrees**, automations (cron/webhook/event), BYO agent via **Agent Client Protocol (ACP)** (Claude Code, Codex, Gemini CLI, OpenHands).
- **UI:** Conversation/home list, chat, automations list/detail, skills, MCP — more **session + automation studio** than topology map.
- **Scale story:** Local agent-server → self-hosted VM → OpenHands Cloud; same UI across backends.
- **Takeaways:** ACP multi-harness is the interoperability story Orca already partially has (Claude/Codex/OMP/Grok/…). Automations as first-class peers of interactive sessions is a product move Orca orchestration is still mostly CLI-shaped.

#### Cursor Glass / Agents Window (Cursor 3, ~Mar–Apr 2026)
- **Positioning:** Agent management as **primary surface**; editor secondary (“passenger seat”).
- **UI:** Unified workspace for agents, repos, cloud tasks; multi-repo; local ↔ cloud handoff mid-task; integrated browser/terminal/files; agent filtering; project threads.
- **Landscape role (Addy Osmani):** Control plane becomes primary; editor is one instrument underneath.
- **Takeaways:** Validates Orca’s bet that a global agent viewer is not a “settings page” — it is the daily driver at fleet scale. Glass still skews **session list / threads**, not containment topology.

#### Conductor (conductor.build, Melty Labs, YC S24)
- **UI:** Polished macOS dashboard: parallel Claude Code / Codex / Cursor agents in isolated worktrees; **diff-first review**; checkpoints; spotlight testing; Linear issue start.
- **Mental model:** CEO of a small org — glance at work, dive into diffs, merge.
- **Sweet spot:** 3–8 parallel features on one repo.
- **Takeaways:** Closest commercial cousin to Orca’s worktree-per-agent model. Diff-first review + worktree lifecycle is table stakes; Conductor does **not** solve 100+ agent accounting.

#### Weave Agent Fleet (tryweave.io/fleet)
- **UI:** Local web dashboard (`localhost:3000`): multi-session OpenCode management, status, diffs, event streams; SQLite persistence.
- **Unique twist:** *Agents orchestrate agents* via fleet-orchestration skill (spawn children, callbacks, conflict detection on overlapping files) — not only human dashboard.
- **Takeaways:** Human fleet UI + agent-driven fan-out is exactly Orca orchestration’s dual audience. Callback-driven parent/child completion > polling silence (matches Orca’s “silence ≠ death” invariant).

#### Vibe Kanban (vibekanban.com / BloopAI; sunsetting commercial, OSS continues)
- **UI:** Plan → Prompt → Review. Kanban issues, agent workspaces (branch + terminal + dev server), inline diff comments, built-in browser QA, multi-agent switch (Claude, Codex, Gemini, Cursor, Amp, OpenCode, …).
- **Thesis:** Bottleneck shifted to **planning and review**, not typing.
- **Takeaways:** Strongest **workflow board** pattern. Orca should not replace Linear/GitHub issues, but a fleet view that surfaces *review-ready* and *blocked* columns is proven.

### 3.3 Command-center / mission-control aesthetics (X-heavy)

| Product / post | UI idea | Relevance |
|----------------|---------|-----------|
| **Moltbot Agent Canvas UI** (George Pickett, Jan 2026) | Local-first visual command center: what’s running, live stream, shared context | Early “terminals bad for teams of agents” narrative |
| **Mission Control + OpenClaw** (Kol Tregaskes, Feb 2026) | React/Convex dashboard, 10 agents, threaded agent debates, claims/reviews | Social/team metaphor for agent collab |
| **AgentCommand** (Matt Schlicht / MattPRD) | Dashboard for agents running agents; 1000+ spin-up; revenue/deploys/diffs live | Extreme-scale *metrics wall* more than IDE |
| **DASH** (Peter Broas) | Agentic workspace widgets + MCP bar; open agents on canvas from chat | Widget mosaic + AI bar as router |
| **LangGraph multi-agent dashboards** | React Flow / Cytoscape graph + fleet rail + logs | Graph orchestration visualization (fan-out/verify/merge) |

### 3.4 Cloud async agent panels (Tier 3)

Claude Code Web, GitHub Copilot Coding Agent Agents panel, Jules, Codex Web — **issue → cloud VM → PR** lists with plan approval and evidence. Less “canvas,” more **async job board**. Important so Orca fleet UI can later show *cloud/async* siblings without looking like a second product.

### 3.5 Historical community seed (Orca-specific lore)

- Parent conversation recalled **amethystliang** community PR / canvas-style agent view as inspiration for Iron Man **fleet-rings**.
- **OpenHands Agent Canvas** (and earlier forks like rbren/agent-canvas, voicetreelab/agent-canvas) is the current canonical open “Agent Canvas” brand — distinct from freeform tile canvases.

---

## 4. Cross-cutting UI patterns (what actually ships)

### 4.1 Layout patterns that won

1. **Session / card list** (most shipping products) — simple, scannable, collapses at scale.
2. **Kanban / work board** — optimizes human review queue.
3. **Infinite freeform canvas** — delightful for small fleets; poor default at Orca scale without auto-layout.
4. **Containment topology** (rare in agent products; common in infra) — project/worktree/host nesting. **Orca mocks lead here.**
5. **Graph of agent workflow** (LangGraph UIs) — good for *orchestration topology*, bad as sole fleet map of live PTYs.

### 4.2 Interaction patterns that matter

| Pattern | Who does it | Orca fit |
|---------|-------------|----------|
| Hover → live terminal preview | Conductor-class dashboards; Orca rings mocks | **Keep** — already in refined mocks |
| Diff-first review in board | Conductor, Vibe Kanban, Weave | **Keep** — source-control deep link |
| Respond-in-place (permissions/questions) | LangChain Agent Inbox; Orca control-room | **Differentiator** — few products coalesce decisions |
| Latched “to review” until explicit ack | Orca control-room (ISA-18.2) | **Differentiator** — almost no one ships this |
| Spatial stability (no resort-by-activity) | Orca; infra tools after force-layout failures | **Differentiator** |
| Local ↔ cloud handoff | Cursor Glass | Future Orca host/runtime story |
| Multi-machine on one canvas | 49Agents | Aligns with SSH/WSL/remote runtime |
| Agent-spawned children + callbacks | Weave Fleet skill | Aligns with orchestration Run/Dispatch |
| Automations as first-class | OpenHands Agent Canvas | Aligns with Orca automations product |
| Broadcast input / multi-terminal send | 49Agents | Power feature, not default |

### 4.3 Visual encoding consensus

- **State color + non-color channel** (shape, motion, badge) — Orca already enforces styleguide + AgentStateDot.
- **Quiet chrome / saturated only for human-needed states** — matches Orca STYLEGUIDE and control-room grayscale-normal budget.
- **Liveness ≠ importance** — working can be dim; needs-you blinks; motionless board = healthy (Orca tenet; rare elsewhere — most UIs celebrate busy spinners).

### 4.4 Scale failure modes observed

- Freeform canvases: layout entropy, lost agents off-viewport.
- Force-directed graphs: Kiali/Nomad history shows physics layouts get deleted.
- Pure terminal walls: impressive demos (Orca wall mock; AgentCommand scale porn), unusable without aggressive folding.
- Pure session lists: lose project/worktree structure Orca users live in.

---

## 5. Implications for Orca fleet-canvas

### 5.1 Do not copy

- **Default freeform infinite canvas as the primary fleet UI** for 100–400 terminals — Collaborator/49Agents stop being legible past ~15–30 panes.
- **Force-directed agent graphs as the home view** — use graphs only for *selected lineage* (already in fleet-map mock).
- **Busy neon “everything is spinning” aesthetics** — contradicts Orca’s healthy-quiet fleet tenet.
- **Replacing the editor** as a separate Cursor Glass clone — Orca’s strength is *terminals as agents* already embedded in the IDE.

### 5.2 Steal shamelessly

1. **Conductor:** worktree lifecycle + diff-first review polish + “see at a glance then dive.”
2. **Vibe Kanban:** review column as first-class; inline comments back to agent; plan/prompt/review stages as language.
3. **Weave Fleet:** parent/child callbacks; overlap conflict summary after parallel children; local SQLite-style durability for fleet view state.
4. **OpenHands Agent Canvas:** multi-harness ACP story; automations as peers of sessions; backend switcher in chrome.
5. **49Agents:** multi-host resource strip; mobile glance; issue-tagged terminals; broadcast as power tool.
6. **Cursor Glass:** agent-first *mode* (full-screen fleet) without abandoning IDE embedding.

### 5.3 Double down (Orca already ahead)

From `agent-fleet-control-room` / `agent-fleet-refined` READMEs — these remain the right product spine:

1. Whole fleet always accounted for (count line).
2. State preattentive (color + glyph + motion rate).
3. One step from see → respond in place.
4. Spatial stability via **project → worktree → agent** containment (Fleet Rings).
5. Latched TO REVIEW until explicit review.
6. Actionable unit = **coalesced decision**, not agent card spam.
7. Degrade 5 → 150+ (labels hide before agents; failures/PRs never fold).
8. Liveness aesthetic: still board = good.

**Recommended hybrid (already sketched in mission-control.html):**  
**Left/center:** containment map or rings (awareness).  
**Right/rail:** intervention strips / triage inbox (action).  
**Escalation:** pin terminal popover (not full canvas navigation).  
Optional tertiary: **terminal wall** as a density mode, not the default.

### 5.4 Design tenets distilled for next prototype pass

| # | Tenet | Market evidence |
|---|-------|-----------------|
| 1 | Control plane is primary at fleet scale | Cursor Glass, Conductor, OpenHands Canvas |
| 2 | Containment > freeform for 50+ | Infra tools abandoned physics; freeform canvases cap low |
| 3 | Decision unit > agent unit | Inbox products; almost no competitor coalesces |
| 4 | Review latch is a safety system | Industry ships fire-and-forget “done”; Orca should not |
| 5 | Hover preview, click escalate | Universal desire path |
| 6 | Diff + PR are first-class cards | Conductor/Vibe Kanban |
| 7 | Multi-host is part of the map | 49Agents; Orca SSH/WSL reality |
| 8 | Agents-orchestrating-agents must be visible | Weave; Orca Dispatch tree |
| 9 | Quiet is healthy | Control-room research; avoid spinner theater |
| 10 | Automations sit beside interactive agents | OpenHands |

---

## 6. Competitive positioning one-liner

> **Most agent products show you sessions. Orca should show you the fleet and the decisions that unblock it — with worktree containment for spatial memory and an intervention rail for the human bottleneck.**

---

## 7. Suggested next research/design steps (out of scope for this task)

1. Side-by-side screenshot matrix: Conductor / Glass / OpenHands Canvas / 49Agents / Vibe Kanban vs Orca `mission-control` / `fleet-rings` / `fleet-strips` at the same 100-agent fixture.
2. User-test **map+rail hybrid** vs pure triage list at 20 vs 100 agents.
3. Prototype **Dispatch/Run lineage overlay** on the containment map (orchestration provenance).
4. Evaluate ACP-style multi-harness labeling in the fleet chrome (agent kind badge).

---

## 8. Sources (selected)

### Web
- OpenHands Agent Canvas: https://www.openhands.dev/product/canvas
- OpenHands ACP blog / docs: openhands.dev docs agent-canvas
- Weave Agent Fleet: https://tryweave.io/fleet/
- Conductor: https://www.conductor.build/
- Vibe Kanban: https://vibekanban.com/ · https://github.com/BloopAI/vibe-kanban
- Collaborator: https://github.com/collabs-inc/collab-public
- 49Agents: https://www.49agents.com/ · https://github.com/49agents/49agents
- Addy Osmani — *The Code Agent Orchestra* (Mar 2026): https://addyosmani.com/blog/code-agent-orchestra/
- Cursor Glass / Agents Window coverage (Cursor 3, 2026)
- awesome-agent-orchestrators: https://github.com/andyrewlee/awesome-agent-orchestrators

### X (semantic + keyword)
- Moltbot Agent Canvas UI (George Pickett)
- Mission Control OpenClaw dashboard (Kol Tregaskes)
- AgentCommand 1000+ agents (Matt Schlicht)
- 49Agents canvas IDE positioning
- OpenHands Agent Canvas product posts
- Multi-agent graph dashboard build notes (LangGraph + React Flow patterns)

### Local Orca prior art (read-only, parent albacore)
- `agent-fleet-concepts/`, `agent-fleet-refined/`, `agent-viewer-alternatives/`, `agent-fleet-control-room/`
- Especially: Fleet Rings, Command Deck, mission-control hybrid, fleet-map, fleet-strips, fleet-triage tenets README

---

## 9. Completion status

- Research survey complete for abbreviated task interpreted via run objective.
- Full coordinator brief never arrived (orchestration mutation path broken for this dispatch).
- No worktree files modified.
- Artifact path: `/tmp/orca-research/task_e78c9946452e-fleet-canvas-ui-survey.md`
