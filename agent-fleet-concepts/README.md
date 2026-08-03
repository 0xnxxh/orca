# Orca Agent Fleet Concepts

Six ways to operate a fleet too large for one-card-per-agent UI:

- **Constellation** — spatial worktree clusters with agent lineage on demand.
- **Tactical Radar** — urgency radiates from the center; distance means intervention priority.
- **Fleet Matrix** — compact, sortable operations view for all worktrees and agents.
- **Timeline Lanes** — exposes long-running agents, quiet terminals, and time outliers.
- **Orchestrator HUD** — a worktree-less global command layer based on PR #1896.
- **Mission Treemap** — area communicates agent count while edge state communicates urgency.

## Recommended direction

Combine three layers with semantic zoom:

1. **Orchestrator HUD** stays globally summonable and collapses 168 agents into decisions.
2. **Radar** is the default ambient overview for attention, activity, and host health.
3. **Matrix** is the dense fallback for exact inspection, filtering, and bulk action.

Drill-down should follow fleet → worktree → lineage → terminal. The interface should never
render every agent as a full card or labeled graph node at once.

The mock data reflects the live fleet observed while designing: 168 visible agents, 34
working, 71 unread worktrees, and 332 terminals.
