import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { buildDashboardSnapshot } from './build-dashboard-snapshot'

// Why: cap snapshot rebuilds during bursts of agent-status pings. The board is a
// glanceable surface, so ~4 updates/sec is plenty and keeps the cross-worktree
// rebuild off the hot path.
const PUBLISH_THROTTLE_MS = 250

/**
 * Runs in the MAIN window (mount once in App). Two responsibilities:
 *  1. While the pop-out dashboard is open, derive the snapshot from the live
 *     store and publish it to the main process (which relays it to the popout).
 *     Does nothing while the popout is closed, so it's free in the common case.
 *  2. Handle click-to-focus reveal requests forwarded from the popout: activate
 *     the agent's worktree and focus its pane in this (main) window.
 */
export function useDashboardPopoutBridge(): void {
  useEffect(
    () =>
      window.api.dashboard.onRevealAgent((args) => {
        useAppStore.getState().setActiveWorktree(args.worktreeId)
        activateTabAndFocusPane(args.tabId, args.leafId, { flashFocusedPane: true })
      }),
    []
  )

  // Opening a card's terminal dialog in the popout acks the agent here — the
  // same ack the sidebar's bold/mute treatment reads, keeping both in lockstep.
  // ?. shields App mount from dev-HMR preload skew (preload updates only on
  // app restart).
  useEffect(
    () =>
      window.api.dashboard.onAckAgent?.((paneKey) => {
        useAppStore.getState().acknowledgeAgents([paneKey])
      }),
    []
  )

  useEffect(() => {
    let open = false
    let disposed = false
    let unsubscribeStore: (() => void) | null = null
    let trailingTimer: ReturnType<typeof setTimeout> | null = null
    let lastPublishAt = 0

    const publishNow = (): void => {
      lastPublishAt = Date.now()
      const snapshot = buildDashboardSnapshot(useAppStore.getState(), lastPublishAt)
      void window.api.dashboard.publishSnapshot(snapshot)
    }

    // Leading + trailing throttle so the first change paints immediately and
    // bursts collapse into one trailing publish.
    const publishThrottled = (): void => {
      if (!open || disposed) {
        return
      }
      const elapsed = Date.now() - lastPublishAt
      if (elapsed >= PUBLISH_THROTTLE_MS) {
        if (trailingTimer) {
          clearTimeout(trailingTimer)
          trailingTimer = null
        }
        publishNow()
        return
      }
      if (!trailingTimer) {
        trailingTimer = setTimeout(() => {
          trailingTimer = null
          if (open && !disposed) {
            publishNow()
          }
        }, PUBLISH_THROTTLE_MS - elapsed)
      }
    }

    const setOpen = (next: boolean): void => {
      if (next === open || disposed) {
        return
      }
      open = next
      if (open) {
        if (!unsubscribeStore) {
          unsubscribeStore = useAppStore.subscribe(publishThrottled)
        }
        publishNow()
      } else {
        unsubscribeStore?.()
        unsubscribeStore = null
        if (trailingTimer) {
          clearTimeout(trailingTimer)
          trailingTimer = null
        }
      }
    }

    const offOpenChanged = window.api.dashboard.onPopoutOpenChanged((next) => setOpen(next))
    // Popout mount asks for a fresh snapshot (its cached one may be stale).
    const offRequested = window.api.dashboard.onSnapshotRequested(() => {
      if (open) {
        publishNow()
      }
    })
    // Recover the open state when the main window (re)mounts while a pop-out is
    // already open — e.g. after a renderer reload.
    void window.api.dashboard.getPopoutOpen().then((isOpen) => {
      if (!disposed && isOpen) {
        setOpen(true)
      }
    })

    return () => {
      disposed = true
      offOpenChanged?.()
      offRequested?.()
      unsubscribeStore?.()
      if (trailingTimer) {
        clearTimeout(trailingTimer)
      }
    }
  }, [])
}
