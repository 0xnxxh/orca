# Agent fleet visualization survey (k8s-style canvas inspiration)
Date: 2026-08-01 | Mode: research-only | Task: task_e78c9946452e

## Ranking criterion
Higher = closer to a VISUAL multi-agent fleet surface (canvas/map/graph/nodes/minimap), not lists/kanbans. Ship-now products preferred.

---

## RANKED — VISUAL FLEET / CANVAS FIRST

### 1. OpenCove (DeadWaveWave) — ★ PRIMARY REFERENCE
**Fleet view:** Infinite pan/zoom 2D canvas (@xyflow/react) of agent sessions, terminals (xterm.js+node-pty), tasks, and notes as free-placed nodes; parallel CLI agents (Claude Code/Codex) stay spatially co-visible; persistent viewport/layout; global search + control center; workspace isolation via dirs/worktrees; Electron desktop + experimental Worker Web UI.
**Why #1:** Closest shipping "agent fleet canvas" with modern node graph stack; spatial context over tabs; screenshots in repo.
**Links:** https://github.com/DeadWaveWave/opencove | https://github.com/DeadWaveWave/opencove/releases | https://github.com/DeadWaveWave/opencove/blob/main/README.md | preview assets https://github.com/DeadWaveWave/opencove/blob/main/assets/images/opencove_app_preview_readme.jpg | short demo https://www.youtube.com/shorts/A8l5JDmtlbA | xyflow MiniMap (stack sibling) https://reactflow.dev/api-reference/components/minimap

### 2. Collaborator (collabs-inc) — infinite tile canvas
**Fleet view:** Infinite pan/zoom canvas of terminal/note/code/image tiles; double-click → terminal tile (agent host); drag files from navigator; grid snap; multi-workspace; local-first Electron; D3 available for graphs.
**Why high:** Pure spatial terminal fleet without orchestration lock-in.
**Links:** https://github.com/collabs-inc/collab-public | https://github.com/collabs-inc/collab-public/blob/main/README.md | https://github.com/collaborator-ai/collab-public/releases/latest

### 3. 49Agents — multi-machine 2D agentic IDE canvas
**Fleet view:** Infinite zoomable canvas of terminals, git graphs, notes, resource monitors as panes; multi-machine without SSH; broadcast input; issue tags; mobile check-in; free tier caps terminals.
**Why high:** Explicit "15 agent tabs → one canvas" product pitch; multi-host = k8s-node vibe.
**Links:** https://www.49agents.com/ | https://github.com/49agents/49agents | https://x.com/49agents | HN https://news.ycombinator.com/item?id=47942287

### 4. cmux — terminal + experimental freeform canvas + minimap
**Fleet view:** Primary = vertical-tab Ghostty terminal with notification rings when agents need attention; subagents become native panes; programmable CLI. Experimental freeform 2D canvas layout for workspace panes + minimap navigation polish (PRs #5987, #6105).
**Why high for Orca:** Best-in-class attention encoding (rings/badges); minimap is the right "fleet overview" affordance even if still experimental.
**Links:** https://cmux.com/ | https://github.com/manaflow-ai/cmux | changelog canvas/minimap https://cmux.com/docs/changelog | Mitchell H. mention https://x.com/mitchellh/status/2024913161238053296

### 5. AgentGrid (Product Hunt / X Jul 2026)
**Fleet view:** Team of coding agents (builder/QA/devops) on one infinite canvas with orchestrator loop — closest "spawn a squad on a board" demo in recent X.
**Links:** X demo https://x.com/yagudaev/status/2078376271864869134 | Product Hunt (via post)

### 6. OpenHands Agent Canvas
**Fleet view:** Browser/desktop control surface for parallel agents in isolated worktrees; conversation + automations + skills/MCP; multi-harness via ACP (Claude Code, Codex, Gemini CLI, OpenHands); local→VM→cloud backends. Visual is session/automation studio more than freeform node map.
**Links:** https://www.openhands.dev/product/canvas | https://docs.openhands.dev/openhands/usage/agent-canvas/overview | https://github.com/OpenHands/agent-canvas | ACP blog https://www.openhands.dev/blog/use-any-coding-agent-in-openhands-with-acp | X product https://x.com/OpenHandsDev

### 7. Cursor Glass / Agents Window (Cursor 3)
**Fleet view:** Agent-first full-screen workspace (Glass); parallel local/cloud/SSH agents across repos; editor secondary; cloud handoff mid-task; threads + filters. Visual = agent cards/sessions, not topology map.
**Links:** https://cursor.com/docs/agent/agents-window | https://cursor.com/glass | review https://www.digitalapplied.com/blog/cursor-3-agents-window-complete-guide | Addy Osmani landscape https://addyosmani.com/blog/code-agent-orchestra/

### 8. Conductor (Melty Labs)
**Fleet view:** Polished macOS dashboard of parallel Claude Code/Codex/Cursor agents in git worktrees; glance status + diff-first review + checkpoints; Linear start. Visual = multi-agent cards/diff rails (strong), not freeform canvas.
**Links:** https://www.conductor.build/ | YC https://www.ycombinator.com/companies/conductor | spotlight https://addyosmani.com/blog/code-agent-orchestra/

### 9. Weave Agent Fleet
**Fleet view:** Local web dashboard (localhost:3000) of OpenCode sessions with status/diffs/streams; parent agents spawn children with callbacks + overlap conflict detection. Visual = multi-session grid/list with live streams.
**Links:** https://tryweave.io/fleet/ | https://github.com/pgermishuys/weave-agent-fleet

### 10. Devin Desktop — Agent Command Center (Cognition)
**Fleet view:** Agent Command Center as DEFAULT IDE surface: Kanban-style board of local Devin, cloud Devin, and ACP third-party agents (Codex/Claude/OpenCode); Spaces for shared context; full Windsurf-compat editor underneath. Mission-control language, kanban encoding.
**Links:** https://cognition.com/blog/introducing-devin-desktop | https://devin.ai/ | https://devin.ai/download | review https://www.fixedlabs.ai/blog/devin-desktop-review

### 11. OpenAI Codex app + Codex cloud
**Fleet view:** Native macOS/Windows Codex app for multi-agent parallel worktrees, long-running supervision, GitHub PRs; cloud = isolated env job board from web/GitHub/Linear/Slack. Visual = multi-task agent supervisor, not canvas.
**Links:** https://openai.com/index/introducing-the-codex-app/ | https://developers.openai.com/codex/app | cloud https://learn.chatgpt.com/docs/cloud

### 12. GitHub Copilot Agents panel / VS Code Agents window
**Fleet view:** Site-wide Agents panel (model picker, cloud coding agent, third-party/custom agents) + VS Code Agents window unifying local/background/cloud/third-party sessions. Visual = mission-control list, not map.
**Links:** https://github.com/features/copilot/agents | https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent | https://github.blog/ai-and-ml/github-copilot/whats-new-with-github-copilot-coding-agent/ | VS Code https://code.visualstudio.com/docs/agents/overview | multi-agent blog https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development

### 13. Claude Code Agent view
**Fleet view:** Full-terminal roster (`claude agents`) grouped by state; needs-you + pinned on top; peek/reply without leaving list. Visual = TUI table, excellent state priority, not spatial.
**Links:** https://code.claude.com/docs/en/agent-view

### 14. Herdr
**Fleet view:** Rust tmux-class agent multiplexer; sidebar of agents with blocked/working/done; real PTY panes; detach/SSH. Visual = pane grid + state list.
**Links:** https://herdr.dev/ | https://herdr.dev/docs/agents/ | https://github.com/herdrdev/herdr | Better Stack https://betterstack.com/community/guides/ai/herdr-ai-agent/

### 15. claude-squad
**Fleet view:** Terminal app managing multi Claude/Codex/Gemini/Aider in workspaces; one window supervise + review. Visual = TUI multi-instance manager.
**Links:** https://github.com/smtg-ai/claude-squad | https://smtg-ai.github.io/claude-squad/

### 16. Vibe Kanban
**Fleet view:** Plan → Prompt → Review kanban; worktree workspaces; inline diffs; multi-agent switch; sunsetting commercial / OSS continues. Strong workflow, low canvas score.
**Links:** https://vibekanban.com/ | https://github.com/BloopAI/vibe-kanban

### 17. Factory Droid
**Fleet view:** TUI + desktop app with multi-session sidebar; Missions multi-agent; dynamic in-conversation Mermaid/charts (agent-generated viz, not fleet topology).
**Links:** https://factory.ai/ | desktop https://factory.ai/news/factory-desktop | docs https://docs.factory.ai/cli/getting-started/how-to-talk-to-a-droid

### 18. Amp (Sourcegraph)
**Fleet view:** Terminal/editor agent with subagents + Task tool; web/phone start; "orb" multiplayer sharing; not a fleet map product.
**Links:** https://ampcode.com/ | https://ampcode.com/manual

### 19. Terragon
**Fleet view:** Cloud Claude/Codex/etc background agents + task dashboard/PR flow. Async job board, not canvas.
**Links:** https://www.terragonlabs.com/ | https://terragon.devdocs.ai/ | writeup https://ymichael.com/2025/07/15/claude-code-unleashed.html

### 20. Pebble (Nebutra)
**Fleet view:** Appears as Orca-adjacent product port (Nebutra/pebble tracks Upstream Orca renderer semantic ports) — not a distinct public fleet-canvas brand found in web search beyond that lineage.
**Links:** https://github.com/Nebutra/pebble (issues show Upstream Orca porting) | compare Orca agents docs https://www.onorca.dev/docs/model/agents-sessions

### Also-notable newer / adjacent
- **Codecast** mobile+web agent inbox: https://codecast.sh/
- **Junction Panel** local agent dashboard: https://junctionpanel.dev/ai-coding-agent-dashboard/
- **Agent-teams-ai** kanban multi-agent desktop: https://github.com/777genius/agent-teams-ai
- **AgentCommand** (MattPRD X) extreme-scale agent-of-agents dashboard: https://x.com/MattPRD/status/2012743002985484479
- **Moltbot Agent Canvas UI**: https://x.com/georgepickett/status/2017046827686908246
- **Alex @alexyango** agent-native Slack + experimental infinite canvas (Jul 2026): https://x.com/alexyango/status/2079104946700788179
- **Dessn Canvas** design agents on infinite canvas: https://x.com/Dessn_ai/status/2077029646961348634
- Landscape survey: https://addyosmani.com/blog/code-agent-orchestra/ | https://github.com/andyrewlee/awesome-agent-orchestrators

---

## TOP 5 REFERENCES for a minimal modern pan/zoom canvas of repo systems + agent nodes

1. **OpenCove** — freeform agent/terminal/task nodes on infinite canvas; `@xyflow/react` + xterm; persistent layout; control center. https://github.com/DeadWaveWave/opencove
2. **React Flow / xyflow MiniMap + Controls** — production minimap + pan/zoom primitives OpenCove-class UIs build on. https://reactflow.dev/api-reference/components/minimap | https://reactflow.dev/
3. **cmux experimental canvas + minimap navigation** — attention rings + minimap overview for multi-workspace agent terminals. https://cmux.com/docs/changelog | https://github.com/manaflow-ai/cmux
4. **49Agents** — multi-host panes on one canvas (k8s "nodes across machines" metaphor). https://www.49agents.com/
5. **Collaborator** — cleanest minimal tile canvas: double-click terminal, drag context files, grid snap, no cloud lock-in. https://github.com/collabs-inc/collab-public

### Design takeaways for Orca k8s-style fleet canvas
- Prefer **containment hierarchy** (project → worktree → agent) over pure freeform once N>30 (OpenCove freeform is best for 5–20; Orca mocks already do rings/map).
- Always ship a **minimap** (xyflow MiniMap pattern; cmux polishing this).
- Encode **needs-you** with non-text channels: cmux notification rings; Claude agent-view state sort.
- Nodes = agents; clusters = repos/worktrees; edges = orchestration lineage (on-demand only).
- Hover → live terminal preview; click → escalate to full PTY (Conductor/OpenCove pattern).
- Diff/PR status as node badge (Conductor/Vibe/Codex), not only chat state.

## Method notes
Web search + product pages + GitHub READMEs + X keyword/semantic (~May–Aug 2026). No worktree files modified. worker_done may fail RPC legacy_read_only on this pane; full findings are in this body.
