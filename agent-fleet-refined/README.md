# Agent Command Deck

## Product thesis

The dashboard has two simultaneous jobs: account for the entire fleet and accelerate
senior-developer intervention.

Every agent remains represented in the command radar, grouped spatially and encoded by
state. Labels expand only for meaningful clusters so complete awareness does not become
168 competing cards. The actionable unit is a **decision**: each one combines the
question, distilled evidence, affected worktrees, recipients, and a persistent response
composer. One response can unblock several agents without leaving the dashboard.

The **Fleet Rings** variant gives spatial placement a concrete meaning:

- Outer rings contain projects.
- Nested rings contain worktrees.
- Agent nodes inside each worktree scale logarithmically with active duration.
- Color and halo communicate operational state independently from duration.
- Hover previews live terminal output; click pins or opens the terminal.
- Placement stays stable between updates so developers build spatial memory.

## Focused Fleet mock

`agent-rings-focus.html` tests an inbox-oriented operating model:

- Focus includes Needs You, Working, and finished results still marked To review.
- Finished results can be filtered to To review, 24 hours, 7 days, or All.
- Opening marks a result seen; only explicit review removes it from Focus.
- Pinning keeps an agent visible through review and other state filters.
- Reviewed results collapse into workspace summaries at larger time windows.
- Duration changes the agent circle itself, not its containing workspace.
- Every visible agent keeps a label and a large click target.
- The terminal supports continuation, review, pinning, and bulk review from the rail.

## Interaction model

1. Open the next intervention.
2. Read the distilled disagreement and evidence.
3. Respond once to every affected agent.
4. Pop up a terminal only when raw context is necessary.
5. Close the terminal and return to the preserved response draft.
6. Send and advance to the next decision.

The orchestrator remains globally available for fleet synthesis, search, and ad hoc
commands. It is a power tool within the command deck, not the primary navigation model.

## Product hierarchy

- **Primary:** Command Radar — complete fleet awareness plus the current intervention.
- **Focused:** Needs You — decisions, permissions, and true blockers.
- **Operational:** Worktrees — precise filtering, inspection, and bulk action.
- **Historical:** History — completed work and retrospective search.

At high scale, the interface must prove that every agent is accounted for while emphasizing
decisions waiting, agents unblocked per response, time to intervention, and work that can
continue unattended.
