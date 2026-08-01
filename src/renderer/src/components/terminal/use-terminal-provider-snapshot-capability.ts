import { useEffect, useMemo } from 'react'
import { useAppStore } from '@/store'
import {
  collectTerminalProviderSnapshotPtyIds,
  startTerminalProviderSnapshotCapabilitySynchronization
} from './terminal-provider-snapshot-capability'

export function useTerminalProviderSnapshotCapability(enabled: boolean): void {
  const tabsByWorktree = useAppStore((state) => state.tabsByWorktree)
  const ptyIdsByTabId = useAppStore((state) => state.ptyIdsByTabId)
  const pendingReconnectPtyIdByTabId = useAppStore((state) => state.pendingReconnectPtyIdByTabId)
  const terminalLayoutsByTabId = useAppStore((state) => state.terminalLayoutsByTabId)
  // Why every id source: synchronize prunes its cache to the ids it is given, so a
  // narrower list here would evict the split-pane and pending-reconnect capability
  // the startup prefetch resolved, dropping those panes back to eager mounting.
  const boundPtyIds = useMemo(
    () =>
      collectTerminalProviderSnapshotPtyIds({
        tabsByWorktree,
        ptyIdsByTabId,
        pendingReconnectPtyIdByTabId,
        terminalLayoutsByTabId
      }),
    [pendingReconnectPtyIdByTabId, ptyIdsByTabId, tabsByWorktree, terminalLayoutsByTabId]
  )

  useEffect(() => {
    // Why: hydration exposes restored PTY ids before activation unlocks; prefetching here preserves cold deferral without blocking render.
    if (!enabled && boundPtyIds.length === 0) {
      return
    }
    return startTerminalProviderSnapshotCapabilitySynchronization(boundPtyIds)
  }, [boundPtyIds, enabled])
}
