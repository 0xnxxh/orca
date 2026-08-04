import type { TerminalLayoutSnapshot } from '../../../../shared/types'
import { terminalLayoutEqual } from '@/lib/terminal-layout-equality'
import { updateWebRuntimePaneLayout } from '@/runtime/web-runtime-session'

export type RemotePaneLayoutPusher = {
  push: (input: { worktreeId: string; tabId: string; layout: TerminalLayoutSnapshot }) => void
  reset: () => void
}

/**
 * Pane geometry is host-authoritative for remote tabs, so persists must push it — but
 * persists also fire on pane-title churn, which leaves the host-visible layout untouched.
 * Dedupe against the last push so unchanged layouts cost no remote round trip.
 */
export function createRemotePaneLayoutPusher(): RemotePaneLayoutPusher {
  let lastPushed: { tabId: string; snapshot: TerminalLayoutSnapshot } | null = null
  return {
    push: ({ worktreeId, tabId, layout }) => {
      if (lastPushed?.tabId === tabId && terminalLayoutEqual(lastPushed.snapshot, layout)) {
        return
      }
      lastPushed = { tabId, snapshot: layout }
      void updateWebRuntimePaneLayout({
        worktreeId,
        tabId,
        root: layout.root,
        expandedLeafId: layout.expandedLeafId,
        ...(layout.titlesByLeafId ? { titlesByLeafId: layout.titlesByLeafId } : {})
      })
    },
    reset: () => {
      lastPushed = null
    }
  }
}
