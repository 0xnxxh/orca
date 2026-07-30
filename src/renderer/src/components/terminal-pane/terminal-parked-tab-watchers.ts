/**
 * Parked terminal tab watcher lifecycle.
 *
 * Why: parking unmounts a tab's TerminalPane, so its PTYs lose the renderer byte
 * parsers. This module runs a pane-less byte watcher per PTY while parked and
 * disposes them on reveal, tab close, PTY exit, or worktree teardown.
 */
import { isTerminalLeafId } from '../../../../shared/stable-pane-id'
import { useAppStore } from '@/store'
import { isRemoteRuntimePtyId, sendRuntimePtyInput } from '@/runtime/runtime-terminal-inspection'
import { closeTerminalTab } from '../terminal/terminal-tab-actions'
import { detachTerminalLayoutLeaf } from './terminal-layout-leaf-detach'
import { subscribeToPtyExit } from './pty-dispatcher'
import { discardPreHandlerPtyState } from './pty-pre-handler-buffer'
import { startParkedTerminalByteWatcher } from './parked-terminal-byte-watcher'
import {
  isParkRestorableTerminalPty,
  selectPairedRuntimeParkingEnvironmentIds,
  type TerminalParkRestorePolicy
} from './terminal-hidden-view-parking'
import {
  reconcileParkedWatcherPtyIds,
  resolveParkedTerminalPaneCandidates,
  type ParkableTerminalTabModel
} from './terminal-parked-watcher-reconciliation'
import {
  resolveTabTitleAfterPaneClose,
  shouldClearLaunchAgentForClosedPane
} from './terminal-pane-close-identity'
import {
  capturedPanesByTabId,
  disposeParkedTabWatchers,
  parkedWatchersByTabId
} from './terminal-parked-watcher-registry'

// Why: re-export so callers keep one import surface; the registry split only breaks the store-slice import cycle.
export {
  captureParkedTerminalPaneCandidates,
  disposeAllParkedTerminalWatchers,
  disposeRemovedWorktreeParkedTerminalWatchers,
  disposeParkedTerminalWatchersForPtyIds,
  disposeParkedTerminalWatchersForWorktree,
  getParkedTerminalWatcherTabIds,
  pruneParkedTerminalWatchers
} from './terminal-parked-watcher-registry'
export type { ParkedTerminalPaneCapture } from './terminal-parked-watcher-registry'
export {
  fallbackParkedPaneCandidates,
  resolveParkedTerminalPaneCandidates
} from './terminal-parked-watcher-reconciliation'
export type { ParkableTerminalTabModel } from './terminal-parked-watcher-reconciliation'
export type ParkedTerminalPtyEligibility = (ptyId: string) => boolean

const allowSnapshotBackedPty = (): boolean => true

// Why: fact-mode watchers work for any pty whose bytes transit local main —
// SSH included — so watcher coverage follows the park-restore policy, not the
// stricter daemon-snapshot predicate.
function parkRestorePolicyFromState(state: {
  settings: { terminalSshViewParking?: boolean } | null
  runtimeStatusByEnvironmentId: ReadonlyMap<
    string,
    { status: { capabilities?: readonly string[] } | null | undefined }
  >
}): TerminalParkRestorePolicy {
  return {
    sshParkingEnabled: state.settings?.terminalSshViewParking !== false,
    pairedRuntimeParkingEnvironmentIds: selectPairedRuntimeParkingEnvironmentIds(
      state.runtimeStatusByEnvironmentId
    )
  }
}

/**
 * Whether parked byte watchers can fully cover this tab's PTYs (every candidate
 * has a park-restorable PTY on a valid leaf). Hosts must refuse to park a tab
 * that fails this check, or bell/title/completion side effects silently drop.
 */
export function canWatcherCoverParkedTerminalTab(
  worktreeId: string,
  tab: ParkableTerminalTabModel,
  // Why: cold activation needs stronger snapshot support (view never mounted); ordinary parking can reattach a mounted view.
  isPtyEligible: ParkedTerminalPtyEligibility = allowSnapshotBackedPty
): boolean {
  const state = useAppStore.getState()
  const panes = resolveParkedTerminalPaneCandidates(tab, state)
  const restorePolicy = parkRestorePolicyFromState(state)
  return (
    panes.length > 0 &&
    panes.every(
      (pane) =>
        pane.ptyId !== null &&
        isTerminalLeafId(pane.leafId) &&
        isParkRestorableTerminalPty(pane.ptyId, worktreeId, restorePolicy) &&
        isPtyEligible(pane.ptyId)
    )
  )
}

function startParkedTabWatchers(
  worktreeId: string,
  tab: ParkableTerminalTabModel,
  restoreTitleOnRegister: boolean
): void {
  const state = useAppStore.getState()
  const panes = resolveParkedTerminalPaneCandidates(tab, state)
  const restorePolicy = parkRestorePolicyFromState(state)
  const disposersByPtyId = new Map<string, () => void>()
  const paneIdByPtyId = new Map<string, number>()
  for (const pane of panes) {
    const ptyId = pane.ptyId
    // Why: re-guard — the tab model can change after the park decision, and legacy non-UUID leaf ids make makePaneKey throw.
    if (
      !ptyId ||
      disposersByPtyId.has(ptyId) ||
      !isTerminalLeafId(pane.leafId) ||
      !isParkRestorableTerminalPty(ptyId, worktreeId, restorePolicy)
    ) {
      continue
    }
    const handlePtyExit = (_code: number, { hadPrimary }: { hadPrimary: boolean }): void => {
      // Why: while parked this sidecar is the only exit observer, so teardown must run here or dead leaves resurrect on reveal.
      useAppStore.getState().clearRuntimePaneTitle(tab.id, pane.paneId)
      if (disposersByPtyId.size > 1) {
        // Why: a parked PaneManager is gone, so its retained primary cannot remove a dead split leaf from persisted layout.
        discardPreHandlerPtyState(ptyId)
        collapseParkedExitedLeaf(tab.id, ptyId)
        disposersByPtyId.get(ptyId)?.()
        disposersByPtyId.delete(ptyId)
        return
      }
      if (hadPrimary) {
        // Why: the sole pane's primary owner closes its tab; retire the sidecar to avoid duplicate confirmation.
        disposersByPtyId.get(ptyId)?.()
        disposersByPtyId.delete(ptyId)
        return
      }

      // Why: keep the empty entry so a pending pinned-close confirm can't let parking restart a watcher on the dead PTY.
      disposersByPtyId.get(ptyId)?.()
      disposersByPtyId.delete(ptyId)
      closeTerminalTab(tab.id, {
        // Why: autonomous PTY exit still needs pinned-tab confirmation but must not enter reopen history.
        captureRecentlyClosed: false,
        // Why: same lifecycle echo as the mounted pty-exit handlers — tag the
        // wire so the host can refuse it while its PTY is live, without
        // `reason: 'pty-exit'` skipping the pinned confirmation above.
        hostCloseReason: 'pty-exit',
        lifecyclePtyId: ptyId,
        onClosed: () => {
          discardPreHandlerPtyState(ptyId)
          const entry = parkedWatchersByTabId.get(tab.id)
          if (entry?.disposersByPtyId === disposersByPtyId) {
            parkedWatchersByTabId.delete(tab.id)
          }
        },
        // Why: cancellation keeps the buffered final frame/exit for the reveal-mounted pane.
        onCancel: () => {}
      })
    }
    const initialTitle = state.runtimePaneTitlesByTabId[tab.id]?.[pane.paneId]
    const disposeWatcher = startParkedTerminalByteWatcher({
      ptyId,
      tabId: tab.id,
      worktreeId,
      leafId: pane.leafId,
      paneId: pane.paneId,
      drivesTabTitle: pane.drivesTabTitle,
      ...(initialTitle !== undefined ? { initialTitle } : {}),
      ...(restoreTitleOnRegister ? { restoreTitleOnRegister: true } : {}),
      sendInput: (data) => {
        sendRuntimePtyInput(useAppStore.getState().settings, ptyId, data)
      }
    })
    // Why: the paired host retires exited surfaces authoritatively; local/SSH
    // exits still arrive through the renderer's singleton main channel.
    const unsubscribeExit = isRemoteRuntimePtyId(ptyId)
      ? () => {}
      : subscribeToPtyExit(ptyId, handlePtyExit)
    paneIdByPtyId.set(ptyId, pane.paneId)
    disposersByPtyId.set(ptyId, () => {
      unsubscribeExit()
      disposeWatcher()
    })
  }
  // Why: track even with zero watchers so window.__terminalParkingDebug reflects every parked tab.
  parkedWatchersByTabId.set(tab.id, {
    worktreeId,
    tabPtyId: tab.ptyId,
    paneIdByPtyId,
    disposersByPtyId
  })
}

/**
 * Called from hosts' onPtyExit before closing the tab; returns true to defer.
 * A parked tab has no PaneManager to promote split siblings, so the live exit
 * path would close the whole tab and kill surviving siblings — reveal remount
 * handles dead PTYs per leaf instead. Single-leaf tabs return false to keep
 * exit→closeTab parity. Also clears the dead leaf's runtime-title slot.
 */
export function shouldDeferParkedPtyExitTabClose(tabId: string, ptyId: string): boolean {
  const entry = parkedWatchersByTabId.get(tabId)
  if (!entry) {
    return false
  }
  const paneId = entry.paneIdByPtyId.get(ptyId)
  if (paneId !== undefined) {
    useAppStore.getState().clearRuntimePaneTitle(tabId, paneId)
  }
  const remaining = entry.disposersByPtyId.size
  if (remaining === 0) {
    if (paneId !== undefined) {
      // Why: empty entry is the pinned-close tombstone; the reveal-mounted pane owns the exit, so suppress once and drop it.
      parkedWatchersByTabId.delete(tabId)
      return true
    }
    return false
  }
  // Why: runs before the sidecar removes the dead watcher, so >1 (or an unwatched PTY) means live siblings remain.
  const defer = remaining > 1 || !entry.disposersByPtyId.has(ptyId)
  if (defer) {
    collapseParkedExitedLeaf(tabId, ptyId)
  }
  return defer
}

// Why: collapse the leaf from the stored layout so reveal can't reattach and resurrect the exited shell.
function collapseParkedExitedLeaf(tabId: string, ptyId: string): void {
  const state = useAppStore.getState()
  const layout = state.terminalLayoutsByTabId[tabId]
  const leafId =
    capturedPanesByTabId.get(tabId)?.panes.find((pane) => pane.ptyId === ptyId)?.leafId ??
    Object.entries(layout?.ptyIdsByLeafId ?? {}).find(([, boundPtyId]) => boundPtyId === ptyId)?.[0]
  if (!leafId) {
    return
  }
  const detached = detachTerminalLayoutLeaf(layout, leafId)
  if (detached) {
    const terminalTab = Object.values(state.tabsByWorktree)
      .flat()
      .find((candidate) => candidate.id === tabId)
    if (shouldClearLaunchAgentForClosedPane(terminalTab, ptyId)) {
      state.clearTabLaunchAgent(tabId)
    }
    state.setTabLayout(tabId, detached.sourceLayout)
    const activeLeafId = detached.sourceLayout.activeLeafId
    const activePtyId = activeLeafId
      ? detached.sourceLayout.ptyIdsByLeafId?.[activeLeafId]
      : undefined
    const activePaneId = activePtyId
      ? (parkedWatchersByTabId.get(tabId)?.paneIdByPtyId.get(activePtyId) ?? null)
      : null
    state.updateTabTitle(
      tabId,
      resolveTabTitleAfterPaneClose(state.runtimePaneTitlesByTabId[tabId] ?? {}, activePaneId)
    )
  }
}

function disposeClosedParkedTabWatchers(
  tabId: string,
  entry: { paneIdByPtyId: ReadonlyMap<string, number> }
): void {
  // Why: a queued pinned-close may close the tab first, leaving no pane to drain retained frames.
  for (const ptyId of entry.paneIdByPtyId.keys()) {
    discardPreHandlerPtyState(ptyId)
  }
  for (const paneId of entry.paneIdByPtyId.values()) {
    useAppStore.getState().clearRuntimePaneTitle(tabId, paneId)
  }
  disposeParkedTabWatchers(tabId)
}

function watchablePtyIds(worktreeId: string, tab: ParkableTerminalTabModel): Set<string> {
  const state = useAppStore.getState()
  const restorePolicy = parkRestorePolicyFromState(state)
  return new Set(
    resolveParkedTerminalPaneCandidates(tab, state).flatMap((pane) =>
      pane.ptyId &&
      isTerminalLeafId(pane.leafId) &&
      isParkRestorableTerminalPty(pane.ptyId, worktreeId, restorePolicy)
        ? [pane.ptyId]
        : []
    )
  )
}

/**
 * Reconciles watchers for one worktree against its rendered parked set.
 * Run from an effect keyed on committed render state so disposal shares the
 * reveal remount's flush (before PTY data IPC) and start follows the park unmount.
 */
export function syncParkedTerminalTabWatchers(args: {
  worktreeId: string
  tabs: readonly ParkableTerminalTabModel[]
  parkedTabIds: ReadonlySet<string>
  /** Parked-equivalent tabs whose pane has not restored the current title. */
  restoreTitleOnStartTabIds?: ReadonlySet<string>
}): void {
  const liveTabIds = new Set(args.tabs.map((tab) => tab.id))
  for (const [tabId, entry] of parkedWatchersByTabId) {
    if (entry.worktreeId !== args.worktreeId) {
      continue
    }
    if (!liveTabIds.has(tabId)) {
      disposeClosedParkedTabWatchers(tabId, entry)
      continue
    }
    if (!args.parkedTabIds.has(tabId) && entry.disposersByPtyId.size > 0) {
      disposeParkedTabWatchers(tabId)
    }
  }
  // Why: closed tabs never park/reveal again; drop captures to keep the registry bounded.
  for (const [tabId, capture] of capturedPanesByTabId) {
    if (capture.worktreeId === args.worktreeId && !liveTabIds.has(tabId)) {
      capturedPanesByTabId.delete(tabId)
    }
  }
  for (const tab of args.tabs) {
    if (!args.parkedTabIds.has(tab.id)) {
      continue
    }
    const entry = parkedWatchersByTabId.get(tab.id)
    const expectedPtyIds = watchablePtyIds(args.worktreeId, tab)
    const reconciliation = entry
      ? reconcileParkedWatcherPtyIds({
          currentTabPtyId: tab.ptyId,
          entryTabPtyId: entry.tabPtyId,
          paneIdByPtyId: entry.paneIdByPtyId,
          expectedPtyIds
        })
      : null
    if (entry && reconciliation?.restart) {
      for (const paneId of reconciliation.retiredPaneIds) {
        useAppStore.getState().clearRuntimePaneTitle(tab.id, paneId)
      }
      disposeParkedTabWatchers(tab.id)
    }
    if (!parkedWatchersByTabId.has(tab.id)) {
      startParkedTabWatchers(
        args.worktreeId,
        tab,
        args.restoreTitleOnStartTabIds?.has(tab.id) === true
      )
    }
  }
}
