# Global agent viewer alternatives

Open `index.html` directly, or serve the repository root:

```sh
python3 -m http.server 4173
```

Then open `http://localhost:4173/agent-viewer-alternatives/`.

## Concepts

1. **Lineage atlas — recommended companion view.** Project and worktree branches contain
   equal-size agent nodes, with child agents connected beneath the agent that started them.
   It makes ownership clear, but takes longer to scan for the newest reply.
2. **Activity lanes — current-data prototype.** Worktrees become compact time lanes using
   thin start-to-end lines from the current Orca session inventory. Working sessions end at
   **Now**; completed sessions stop at completion. Sessions older than two hours are hidden
   until **Show older** is selected. Orchestrated children sit under their parent even when
   they run in another worktree; their own worktree remains in the row label.

Queue cells was removed because it duplicated the existing Dashboard instead of providing
a distinct viewer.

## Current data

`actual-agent-activity.json` is a metadata-only snapshot captured from
`orca worktree ps --json`. Session starts come from the first transcript metadata record,
with persisted terminal creation time as a fallback. The capture does not copy terminal
output, transcript messages, assistant responses, or file contents. Refresh both the JSON
and browser-loadable snapshot with:

```sh
node agent-viewer-alternatives/capture-agent-activity-snapshot.mjs
```

Set `ORCA_AGENT_ACTIVITY_USER_DATA` when the relevant Orca profile data uses a custom data
directory. The generated snapshot and actual-data screenshot are ignored by Git so local
session labels are not committed accidentally.

## Shared interaction model

- Older completed sessions are hidden by default; **Show older** and **Hide older** are
  reversible.
- Recent, status, project, worktree, and text filters work in every concept.
- Selecting any agent makes room for the same dashboard-style terminal panel beside the
  current context.
- Dragging an agent to **Talk to any agent** adds a recipient without sending. **Add to
  Talk** is the keyboard and non-drag fallback.
- Working agents use the production yellow spinner/glow treatment; done agents use green.
- Agent icons stay equal size within every concept.
- Tabs, filters, agent buttons, recipient controls, theme switching, and the message form
  are keyboard accessible. `Cmd+K` on macOS and `Ctrl+K` elsewhere focuses search.

## Recommendation

Keep the existing Dashboard as the operational default and add visible lineage there.
Activity lanes is the history-oriented alternative; Lineage atlas remains the focused
relationship view.

## Validation

- `node --check app.js`
- Browser interaction pass from both the local HTTP URL and direct `file://` opening
- Two concept tabs, light/dark switching, filters, show/hide older, side panel, keyboard
  search, drag recipient flow, non-drag fallback, and follow-up submission
- Responsive checks at 1200px and 800px with no page-level horizontal overflow
- Equal 36×36 agent icons and no browser console or page errors
