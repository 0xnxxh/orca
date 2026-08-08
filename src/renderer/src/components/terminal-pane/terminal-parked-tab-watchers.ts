/**
 * Parked terminal tab watcher lifecycle.
 *
 * Parking is a two-phase handoff: prepare exact pane observers while mounted,
 * then activate hidden delivery only after React commits the parked render.
 */
import { useAppStore } from '@/store'
import { discardPreHandlerPtyState } from './pty-pre-handler-buffer'
import { collapseParkedExitedLeaf } from './terminal-parked-pty-watcher'
import {
  activateParkedTerminalWatcherEntry,
  disposeParkedTerminalWatcherEntry,
  isParkedTerminalTabPreparationCurrent,
  prepareParkedTerminalTabWatchers
} from './terminal-parked-watcher-preparation'
import type { ParkableTerminalTabModel } from './terminal-parked-watcher-reconciliation'
import {
  capturedPanesByTabId,
  disposeParkedTabWatchers,
  ensurePhasedParkedTabWatcherEntry,
  parkedWatchersByTabId,
  readMountedTerminalPaneCandidates,
  type ParkedTabWatcherEntry
} from './terminal-parked-watcher-registry'

export {
  canWatcherCoverParkedTerminalTab,
  type ParkedTerminalPtyEligibility
} from './terminal-parked-watcher-preparation'
export { isParkedTerminalTabPreparationCurrent }
export {
  captureParkedTerminalPaneCandidates,
  disposeAllParkedTerminalWatchers,
  disposeRemovedWorktreeParkedTerminalWatchers,
  disposeParkedTerminalWatchersForPtyIds,
  disposeParkedTerminalWatchersForWorktree,
  getParkedTerminalWatcherTabIds,
  pruneParkedTerminalWatchers,
  registerMountedTerminalPaneCandidateReader,
  terminalWatcherLiveWorkspaceIds
} from './terminal-parked-watcher-registry'
export type {
  ParkedTabWatcherEntry,
  ParkedTerminalPaneCapture
} from './terminal-parked-watcher-registry'
export {
  fallbackParkedPaneCandidates,
  resolveParkedTerminalPaneCandidates,
  selectParkedTerminalPaneCandidateKey
} from './terminal-parked-watcher-reconciliation'
export type { ParkableTerminalTabModel } from './terminal-parked-watcher-reconciliation'

export function getParkedTerminalWatcherEntry(tabId: string): ParkedTabWatcherEntry | undefined {
  return parkedWatchersByTabId.get(tabId)
}

export function activatePreparedParkedTerminalTabWatchers(args: {
  worktreeId: string
  tabs: readonly ParkableTerminalTabModel[]
  parkedTabIds: ReadonlySet<string>
}): Set<string> {
  const failedTabIds = new Set<string>()
  for (const tab of args.tabs) {
    if (
      !args.parkedTabIds.has(tab.id) ||
      !isParkedTerminalTabPreparationCurrent(args.worktreeId, tab)
    ) {
      continue
    }
    const registeredEntry = parkedWatchersByTabId.get(tab.id)
    if (!registeredEntry) {
      continue
    }
    const entry = ensurePhasedParkedTabWatcherEntry(registeredEntry)
    if (entry.phase === 'parked') {
      continue
    }
    if (
      !activateParkedTerminalWatcherEntry(
        tab.id,
        entry,
        readMountedTerminalPaneCandidates(tab.id, args.worktreeId)
      )
    ) {
      failedTabIds.add(tab.id)
    }
  }
  return failedTabIds
}

export function shouldDeferParkedPtyExitTabClose(tabId: string, ptyId: string): boolean {
  const registeredEntry = parkedWatchersByTabId.get(tabId)
  if (!registeredEntry) {
    return false
  }
  const entry = ensurePhasedParkedTabWatcherEntry(registeredEntry)
  if (entry.phase !== 'parked') {
    return false
  }
  const paneId = entry.paneIdByPtyId.get(ptyId)
  if (paneId !== undefined) {
    useAppStore.getState().clearRuntimePaneTitle(tabId, paneId)
  }
  const remaining = entry.disposersByPtyId.size
  if (remaining === 0) {
    if (paneId !== undefined) {
      parkedWatchersByTabId.delete(tabId)
      return true
    }
    return false
  }
  const defer = remaining > 1 || !entry.disposersByPtyId.has(ptyId)
  if (defer) {
    collapseParkedExitedLeaf(tabId, ptyId)
  }
  return defer
}

function disposeClosedTabWatchers(
  tabId: string,
  entry: { paneIdByPtyId: ReadonlyMap<string, number> }
): void {
  for (const ptyId of entry.paneIdByPtyId.keys()) {
    discardPreHandlerPtyState(ptyId)
  }
  for (const paneId of entry.paneIdByPtyId.values()) {
    useAppStore.getState().clearRuntimePaneTitle(tabId, paneId)
  }
  disposeParkedTabWatchers(tabId)
}

export function syncParkedTerminalTabWatchers(args: {
  worktreeId: string
  tabs: readonly ParkableTerminalTabModel[]
  parkedTabIds: ReadonlySet<string>
  desiredParkedTabIds?: ReadonlySet<string>
  restoreTitleOnStartTabIds?: ReadonlySet<string>
}): Set<string> {
  const desiredParkedTabIds = args.desiredParkedTabIds ?? args.parkedTabIds
  const liveTabIds = new Set(args.tabs.map((tab) => tab.id))
  for (const [tabId, registeredEntry] of parkedWatchersByTabId) {
    const entry = ensurePhasedParkedTabWatcherEntry(registeredEntry)
    if (entry.worktreeId !== args.worktreeId) {
      continue
    }
    if (!liveTabIds.has(tabId)) {
      disposeClosedTabWatchers(tabId, entry)
      continue
    }
    if (!desiredParkedTabIds.has(tabId) && entry.disposersByPtyId.size > 0) {
      disposeParkedTerminalWatcherEntry(
        tabId,
        entry,
        readMountedTerminalPaneCandidates(tabId, args.worktreeId),
        entry.retainedRevealPtyIds
      )
    }
  }
  for (const [tabId, capture] of capturedPanesByTabId) {
    if (capture.worktreeId === args.worktreeId && !liveTabIds.has(tabId)) {
      capturedPanesByTabId.delete(tabId)
    }
  }
  const preparedTabIds = new Set<string>()
  for (const tab of args.tabs) {
    if (!desiredParkedTabIds.has(tab.id)) {
      continue
    }
    const registeredEntry = parkedWatchersByTabId.get(tab.id)
    const entry = registeredEntry ? ensurePhasedParkedTabWatcherEntry(registeredEntry) : undefined
    const restoreTitleOnRegister = args.restoreTitleOnStartTabIds?.has(tab.id) === true
    if (
      prepareParkedTerminalTabWatchers({
        worktreeId: args.worktreeId,
        tab,
        allowDurableFallback: entry?.phase === 'parked' || restoreTitleOnRegister,
        restoreTitleOnRegister
      })
    ) {
      preparedTabIds.add(tab.id)
    }
  }
  return preparedTabIds
}
