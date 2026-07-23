import { useCallback } from 'react'
import { useAppStore } from '@/store'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { AgentKanbanBoard } from '../dashboard-popout/AgentKanbanBoard'
import type { AgentRevealArgs } from '../dashboard-popout/AgentTerminalDialog'
import { useLiveDashboardSnapshot } from './useLiveDashboardSnapshot'
import { translate } from '@/i18n/i18n'

/** The in-window Agent Dashboard body. Mounted only while open so the live
 *  snapshot derivation stays off the hot path when the popover is closed. */
function AgentDashboardOverlayBody({ onClose }: { onClose: () => void }): React.JSX.Element {
  const snapshot = useLiveDashboardSnapshot()

  // In-window ack/reveal act on the local store directly — the pop-out's IPC
  // relay is gated to the pop-out renderer and would reject calls from here.
  const handleAckAgent = useCallback((paneKey: string) => {
    useAppStore.getState().acknowledgeAgents([paneKey])
  }, [])
  const handleRevealAgent = useCallback(
    (args: AgentRevealArgs) => {
      useAppStore.getState().setActiveWorktree(args.worktreeId)
      activateTabAndFocusPane(args.tabId, args.leafId, { flashFocusedPane: true })
      onClose()
    },
    [onClose]
  )

  return (
    <AgentKanbanBoard
      snapshot={snapshot}
      containerClassName="h-full w-full"
      onAckAgent={handleAckAgent}
      onRevealAgent={handleRevealAgent}
      onClose={onClose}
    />
  )
}

/**
 * The in-window "screen popover" surface for the experimental Agent Dashboard.
 * The same board as the pop-out window, rendered as a near-fullscreen dialog
 * inside the main window instead of a separate OS window.
 */
export function AgentDashboardOverlay(): React.JSX.Element {
  const open = useAppStore((s) => s.agentDashboardOverlayOpen)
  const setOpen = useAppStore((s) => s.setAgentDashboardOverlayOpen)
  const close = useCallback(() => setOpen(false), [setOpen])

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      {open ? (
        <DialogContent
          aria-describedby={undefined}
          showCloseButton={false}
          // Why: near-fullscreen so the multi-column board has room; the board
          // owns its own header/close, so sm:max-w-none clears the base cap.
          className="flex h-[calc(100vh-40px)] w-[calc(100vw-40px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        >
          <DialogTitle className="sr-only">
            {translate('dashboardPopout.title', 'Agents')}
          </DialogTitle>
          <AgentDashboardOverlayBody onClose={close} />
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
