import { isAgentRenamedTerminalTitle } from '../../../shared/agent-session-rename-title'

// Why: a live OSC title change is the only immediate signal that a deliberate
// `/rename` may have happened — the agent fires no hook for it. Keyed entry
// means a scan is open for that tab; its value is the newest frame waiting
// behind it. Queuing rather than dropping matters because Claude stops
// auto-titling after a rename, so a dropped frame has no later trigger.
const openRefreshByTabId = new Map<string, AgentRenamedTabTitleRefreshArgs | null>()

export type AgentRenamedTabTitleRefreshArgs = {
  tabId: string
  /** Live title the refresh is explaining; a rename must still match it. */
  liveTitle: string
  /** Transcript per pane of the tab — a split tab can run several sessions. */
  transcriptPaths: readonly string[]
  apply: (agentRenamedTitle: string | null) => void
}

export function scheduleAgentRenamedTabTitleRefresh(args: AgentRenamedTabTitleRefreshArgs): void {
  // Why: the store also runs in the headless/web harness, where `window` and the
  // desktop preload bridge may be absent.
  const getRenamedTitle =
    typeof window === 'undefined' ? undefined : window.api?.agentSession?.getRenamedTitle
  if (!getRenamedTitle || args.transcriptPaths.length === 0) {
    return
  }
  if (openRefreshByTabId.has(args.tabId)) {
    openRefreshByTabId.set(args.tabId, args)
    return
  }
  openRefreshByTabId.set(args.tabId, null)
  void (async () => {
    try {
      for (const transcriptPath of args.transcriptPaths) {
        const renamedTitle = await getRenamedTitle({ transcriptPath })
        if (isAgentRenamedTerminalTitle(args.liveTitle, renamedTitle)) {
          args.apply(renamedTitle)
          return
        }
      }
      args.apply(null)
    } catch {
      // Best-effort: an unreadable transcript leaves the generated title in place.
    } finally {
      const queued = openRefreshByTabId.get(args.tabId)
      openRefreshByTabId.delete(args.tabId)
      if (queued) {
        scheduleAgentRenamedTabTitleRefresh(queued)
      }
    }
  })()
}
