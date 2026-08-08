import { isTerminalLeafId } from '../../../../shared/stable-pane-id'
import { isRemoteRuntimePtyId, sendRuntimePtyInput } from '@/runtime/runtime-terminal-inspection'
import { toPtyAdministrativeMutationEvidence } from '../../../../shared/pty-mutation-identity'
import { useAppStore } from '@/store'
import { writePtyWithAdministrativeMutationAccess } from '@/lib/pty-administrative-mutations'
import { closeTerminalTab } from '../terminal/terminal-tab-actions'
import { startParkedTerminalByteWatcher } from './parked-terminal-byte-watcher'
import { subscribeToPtyExit } from './pty-dispatcher'
import { discardPreHandlerPtyState } from './pty-pre-handler-buffer'
import { detachTerminalLayoutLeaf } from './terminal-layout-leaf-detach'
import {
  isParkRestorableTerminalPty,
  type TerminalParkRestorePolicy
} from './terminal-hidden-view-parking'
import type { ParkableTerminalTabModel } from './terminal-parked-watcher-reconciliation'
import {
  resolveTabTitleAfterPaneClose,
  shouldClearLaunchAgentForClosedPane
} from './terminal-pane-close-identity'
import {
  capturedPanesByTabId,
  ensurePhasedParkedTabWatcherEntry,
  parkedWatchersByTabId,
  type ParkedTabWatcherEntry,
  type ParkedTerminalPaneCapture
} from './terminal-parked-watcher-registry'

export function startParkedPtyWatcher(args: {
  worktreeId: string
  tab: ParkableTerminalTabModel
  pane: ParkedTerminalPaneCapture
  entry: ParkedTabWatcherEntry
  restoreTitleOnRegister: boolean
  restorePolicy: TerminalParkRestorePolicy
}): boolean {
  const { worktreeId, tab, pane, restoreTitleOnRegister, restorePolicy } = args
  const entry = ensurePhasedParkedTabWatcherEntry(args.entry)
  const state = useAppStore.getState()
  const ptyId = pane.ptyId
  // Why: the tab model can change after the park decision, and legacy leaf ids make pane keys throw.
  if (
    !ptyId ||
    entry.disposersByPtyId.has(ptyId) ||
    !isTerminalLeafId(pane.leafId) ||
    !isParkRestorableTerminalPty(ptyId, worktreeId, restorePolicy)
  ) {
    return false
  }
  const disposeCurrentWatcher = (retainPaneIdentity = false): void => {
    entry.disposersByPtyId.get(ptyId)?.()
    entry.disposersByPtyId.delete(ptyId)
    entry.activateByPtyId.delete(ptyId)
    entry.revealReplacementAttemptByPtyId.delete(ptyId)
    entry.retainedRevealPtyIds.delete(ptyId)
    if (!retainPaneIdentity) {
      entry.paneCaptureByPtyId.delete(ptyId)
      entry.paneIdByPtyId.delete(ptyId)
    }
  }
  const handlePtyExit = (_code: number, { hadPrimary }: { hadPrimary: boolean }): void => {
    if (entry.phase === 'prepared') {
      entry.preparationValid = false
      disposeCurrentWatcher()
      return
    }
    useAppStore.getState().clearRuntimePaneTitle(tab.id, pane.paneId)
    if (entry.disposersByPtyId.size > 1) {
      discardPreHandlerPtyState(ptyId)
      collapseParkedExitedLeaf(tab.id, ptyId)
      disposeCurrentWatcher()
      return
    }
    if (hadPrimary) {
      disposeCurrentWatcher()
      return
    }

    // Why: the empty entry prevents a pending close confirmation from restarting the dead PTY.
    disposeCurrentWatcher(true)
    closeTerminalTab(tab.id, {
      captureRecentlyClosed: false,
      hostCloseReason: 'pty-exit',
      lifecyclePtyId: ptyId,
      onClosed: () => {
        discardPreHandlerPtyState(ptyId)
        if (parkedWatchersByTabId.get(tab.id) === entry) {
          parkedWatchersByTabId.delete(tab.id)
        }
      },
      onCancel: () => {}
    })
  }
  const initialTitle = state.runtimePaneTitlesByTabId[tab.id]?.[pane.paneId]
  const administrativeMutationAccess = pane.mutationIdentity
    ? {
        mode: 'exact' as const,
        evidence: toPtyAdministrativeMutationEvidence(pane.mutationIdentity)
      }
    : null
  const watcher = startParkedTerminalByteWatcher({
    ptyId,
    ...(pane.mutationIdentity ? { mutationIdentity: pane.mutationIdentity } : {}),
    ...(pane.sideEffectIdentity ? { sideEffectIdentity: pane.sideEffectIdentity } : {}),
    tabId: tab.id,
    worktreeId,
    leafId: pane.leafId,
    paneId: pane.paneId,
    drivesTabTitle: pane.drivesTabTitle,
    ...(initialTitle !== undefined ? { initialTitle } : {}),
    ...(restoreTitleOnRegister ? { restoreTitleOnRegister: true } : {}),
    sendInput: (data) => {
      if (administrativeMutationAccess) {
        writePtyWithAdministrativeMutationAccess(ptyId, data, administrativeMutationAccess)
      } else {
        sendRuntimePtyInput(useAppStore.getState().settings, ptyId, data)
      }
    }
  })
  let unsubscribeExit: (() => void) | null = null
  try {
    unsubscribeExit = isRemoteRuntimePtyId(ptyId)
      ? () => {}
      : subscribeToPtyExit(ptyId, handlePtyExit)
    if (!entry.preparationValid) {
      throw new Error('parked_pty_exited_during_preparation')
    }
    entry.paneCaptureByPtyId.set(ptyId, pane)
    entry.suspendedPtyIds.delete(ptyId)
    entry.revealReplacementAttemptByPtyId.delete(ptyId)
    entry.retainedRevealPtyIds.delete(ptyId)
    entry.paneIdByPtyId.set(ptyId, pane.paneId)
    entry.activateByPtyId.set(ptyId, watcher.activateParked)
    entry.disposersByPtyId.set(ptyId, (options) => {
      try {
        unsubscribeExit?.()
      } finally {
        watcher.dispose(options)
      }
    })
    return true
  } catch {
    entry.paneCaptureByPtyId.delete(ptyId)
    entry.paneIdByPtyId.delete(ptyId)
    entry.activateByPtyId.delete(ptyId)
    entry.disposersByPtyId.delete(ptyId)
    try {
      unsubscribeExit?.()
    } finally {
      watcher.dispose()
    }
    return false
  }
}

export function collapseParkedExitedLeaf(tabId: string, ptyId: string): void {
  const state = useAppStore.getState()
  const layout = state.terminalLayoutsByTabId[tabId]
  const leafId =
    capturedPanesByTabId.get(tabId)?.panes.find((pane) => pane.ptyId === ptyId)?.leafId ??
    Object.entries(layout?.ptyIdsByLeafId ?? {}).find(([, boundPtyId]) => boundPtyId === ptyId)?.[0]
  if (!leafId) {
    return
  }
  const detached = detachTerminalLayoutLeaf(layout, leafId)
  if (!detached) {
    return
  }
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
