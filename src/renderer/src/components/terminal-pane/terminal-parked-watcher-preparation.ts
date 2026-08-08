import { isTerminalLeafId } from '../../../../shared/stable-pane-id'
import { parseAppSshPtyId } from '../../../../shared/ssh-pty-id'
import { isRemoteRuntimePtyId } from '@/runtime/runtime-terminal-inspection'
import { useAppStore } from '@/store'
import { terminalProviderHasAuthoritativeSnapshot } from '../terminal/terminal-provider-snapshot-capability'
import {
  isParkRestorableTerminalPty,
  selectPairedRuntimeParkingEnvironmentIds,
  type TerminalParkRestorePolicy
} from './terminal-hidden-view-parking'
import { startParkedPtyWatcher } from './terminal-parked-pty-watcher'
import {
  resolveParkedTerminalPaneCandidates,
  type ParkableTerminalTabModel
} from './terminal-parked-watcher-reconciliation'
import {
  ensurePhasedParkedTabWatcherEntry,
  parkedWatchersByTabId,
  readMountedTerminalPaneCandidates,
  type ParkedTerminalPaneCapture,
  type PhasedParkedTabWatcherEntry
} from './terminal-parked-watcher-registry'
import { parkedTerminalSideEffectIdentitiesEqual } from './terminal-parked-side-effect-identity'

export type ParkedTerminalPtyEligibility = (ptyId: string) => boolean

const allowOrdinaryParkRestore = (ptyId: string): boolean =>
  isRemoteRuntimePtyId(ptyId) ||
  parseAppSshPtyId(ptyId) !== null ||
  terminalProviderHasAuthoritativeSnapshot(ptyId)

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

function validatePaneCandidates(
  worktreeId: string,
  panes: readonly ParkedTerminalPaneCapture[],
  restorePolicy: TerminalParkRestorePolicy,
  isPtyEligible: ParkedTerminalPtyEligibility = allowOrdinaryParkRestore
): Map<string, ParkedTerminalPaneCapture> | null {
  const panesByPtyId = new Map<string, ParkedTerminalPaneCapture>()
  const leafIds = new Set<string>()
  for (const pane of panes) {
    if (
      !pane.ptyId ||
      !isTerminalLeafId(pane.leafId) ||
      leafIds.has(pane.leafId) ||
      panesByPtyId.has(pane.ptyId) ||
      !isParkRestorableTerminalPty(pane.ptyId, worktreeId, restorePolicy) ||
      !isPtyEligible(pane.ptyId)
    ) {
      return null
    }
    leafIds.add(pane.leafId)
    panesByPtyId.set(pane.ptyId, pane)
  }
  return panesByPtyId.size > 0 ? panesByPtyId : null
}

function readPreparationCandidates(args: {
  worktreeId: string
  tab: ParkableTerminalTabModel
  allowDurableFallback: boolean
}): {
  mountedPanes: ParkedTerminalPaneCapture[] | null
  panesByPtyId: Map<string, ParkedTerminalPaneCapture> | null
} {
  const state = useAppStore.getState()
  const mountedPanes = readMountedTerminalPaneCandidates(args.tab.id, args.worktreeId)
  const panes =
    mountedPanes ??
    (args.allowDurableFallback ? resolveParkedTerminalPaneCandidates(args.tab, state) : [])
  return {
    mountedPanes,
    panesByPtyId: validatePaneCandidates(args.worktreeId, panes, parkRestorePolicyFromState(state))
  }
}

export function canWatcherCoverParkedTerminalTab(
  worktreeId: string,
  tab: ParkableTerminalTabModel,
  isPtyEligible: ParkedTerminalPtyEligibility = allowOrdinaryParkRestore
): boolean {
  const state = useAppStore.getState()
  const panes =
    readMountedTerminalPaneCandidates(tab.id, worktreeId) ??
    resolveParkedTerminalPaneCandidates(tab, state)
  return (
    validatePaneCandidates(worktreeId, panes, parkRestorePolicyFromState(state), isPtyEligible) !==
    null
  )
}

function entryMatchesPreparation(
  tab: ParkableTerminalTabModel,
  entry: PhasedParkedTabWatcherEntry,
  panesByPtyId: ReadonlyMap<string, ParkedTerminalPaneCapture>
): boolean {
  if (
    !entry.preparationValid ||
    entry.tabPtyId !== tab.ptyId ||
    entry.paneCaptureByPtyId.size !== panesByPtyId.size ||
    entry.disposersByPtyId.size + entry.suspendedPtyIds.size !== panesByPtyId.size
  ) {
    return false
  }
  for (const [ptyId, pane] of panesByPtyId) {
    const prepared = entry.paneCaptureByPtyId.get(ptyId)
    if (
      !prepared ||
      prepared.paneId !== pane.paneId ||
      prepared.leafId !== pane.leafId ||
      (prepared.mutationIdentity === undefined) !== (pane.mutationIdentity === undefined) ||
      (prepared.mutationIdentity !== undefined &&
        (prepared.mutationIdentity.incarnationId !== pane.mutationIdentity?.incarnationId ||
          prepared.mutationIdentity.paneGeneration !== pane.mutationIdentity?.paneGeneration ||
          prepared.mutationIdentity.mutationLeaseId !== pane.mutationIdentity?.mutationLeaseId)) ||
      !parkedTerminalSideEffectIdentitiesEqual(
        prepared.sideEffectIdentity,
        pane.sideEffectIdentity
      ) ||
      prepared.drivesTabTitle !== pane.drivesTabTitle ||
      (!entry.disposersByPtyId.has(ptyId) && !entry.suspendedPtyIds.has(ptyId))
    ) {
      return false
    }
  }
  return true
}

function startPreparedTabWatchers(args: {
  worktreeId: string
  tab: ParkableTerminalTabModel
  panesByPtyId: ReadonlyMap<string, ParkedTerminalPaneCapture>
  restoreTitleOnRegister: boolean
  usesDurableCandidates: boolean
}): PhasedParkedTabWatcherEntry {
  const entry: PhasedParkedTabWatcherEntry = {
    worktreeId: args.worktreeId,
    tabPtyId: args.tab.ptyId,
    phase: 'prepared',
    preparationValid: true,
    usesDurableCandidates: args.usesDurableCandidates,
    paneCaptureByPtyId: new Map(),
    suspendedPtyIds: new Set(),
    paneIdByPtyId: new Map(),
    activateByPtyId: new Map(),
    disposersByPtyId: new Map(),
    revealReplacementAttemptByPtyId: new Map(),
    retainedRevealPtyIds: new Set()
  }
  const restorePolicy = parkRestorePolicyFromState(useAppStore.getState())
  for (const pane of args.panesByPtyId.values()) {
    try {
      entry.preparationValid &&= startParkedPtyWatcher({
        worktreeId: args.worktreeId,
        tab: args.tab,
        pane,
        entry,
        restoreTitleOnRegister: args.restoreTitleOnRegister,
        restorePolicy
      })
    } catch {
      entry.preparationValid = false
    }
  }
  entry.preparationValid &&= entry.disposersByPtyId.size === args.panesByPtyId.size
  return entry
}

export function activateParkedTerminalWatcherEntry(
  tabId: string,
  entry: PhasedParkedTabWatcherEntry,
  mountedPanes: readonly ParkedTerminalPaneCapture[] | null
): boolean {
  for (const activate of entry.activateByPtyId.values()) {
    try {
      if (!activate()) {
        throw new Error('parked_watcher_activation_rejected')
      }
    } catch {
      entry.preparationValid = false
      disposeParkedTerminalWatcherEntry(tabId, entry, mountedPanes)
      return false
    }
  }
  entry.phase = 'parked'
  return true
}

export function disposeParkedTerminalWatcherEntry(
  tabId: string,
  entry: PhasedParkedTabWatcherEntry,
  mountedPanes: readonly ParkedTerminalPaneCapture[] | null,
  retainedPtyIds: ReadonlySet<string> = new Set()
): void {
  for (const [ptyId, dispose] of entry.disposersByPtyId) {
    if (retainedPtyIds.has(ptyId)) {
      continue
    }
    const preparedPane = entry.paneCaptureByPtyId.get(ptyId)
    const successorOwnsTitle = mountedPanes?.some(
      (pane) => pane.ptyId === ptyId && pane.paneId === preparedPane?.paneId
    )
    dispose({ preserveRuntimeTitle: successorOwnsTitle === true })
    if (!successorOwnsTitle && preparedPane) {
      useAppStore.getState().clearRuntimePaneTitle(tabId, preparedPane.paneId)
    }
    entry.activateByPtyId.delete(ptyId)
    entry.disposersByPtyId.delete(ptyId)
    entry.suspendedPtyIds.delete(ptyId)
    entry.revealReplacementAttemptByPtyId.delete(ptyId)
    entry.retainedRevealPtyIds.delete(ptyId)
  }
  if (entry.disposersByPtyId.size === 0 && parkedWatchersByTabId.get(tabId) === entry) {
    parkedWatchersByTabId.delete(tabId)
  }
}

export function isParkedTerminalTabPreparationCurrent(
  worktreeId: string,
  tab: ParkableTerminalTabModel
): boolean {
  const registeredEntry = parkedWatchersByTabId.get(tab.id)
  if (!registeredEntry || registeredEntry.worktreeId !== worktreeId) {
    return false
  }
  const entry = ensurePhasedParkedTabWatcherEntry(registeredEntry)
  const { panesByPtyId } = readPreparationCandidates({
    worktreeId,
    tab,
    allowDurableFallback: entry.phase === 'parked' || entry.usesDurableCandidates
  })
  return panesByPtyId !== null && entryMatchesPreparation(tab, entry, panesByPtyId)
}

export function prepareParkedTerminalTabWatchers(args: {
  worktreeId: string
  tab: ParkableTerminalTabModel
  allowDurableFallback: boolean
  restoreTitleOnRegister: boolean
}): boolean {
  const registeredEntry = parkedWatchersByTabId.get(args.tab.id)
  const currentEntry = registeredEntry
    ? ensurePhasedParkedTabWatcherEntry(registeredEntry)
    : undefined
  const { mountedPanes, panesByPtyId } = readPreparationCandidates(args)
  if (!panesByPtyId) {
    if (currentEntry) {
      currentEntry.preparationValid = false
    }
    return false
  }
  if (currentEntry && entryMatchesPreparation(args.tab, currentEntry, panesByPtyId)) {
    return true
  }
  const nextEntry = startPreparedTabWatchers({
    ...args,
    panesByPtyId,
    usesDurableCandidates: mountedPanes === null
  })
  if (!nextEntry.preparationValid) {
    disposeParkedTerminalWatcherEntry(args.tab.id, nextEntry, mountedPanes)
    return false
  }
  if (currentEntry?.phase === 'parked') {
    if (!activateParkedTerminalWatcherEntry(args.tab.id, nextEntry, mountedPanes)) {
      // A partial successor can already have replaced one old fact consumer; reveal instead of retaining a split owner with mixed generations.
      disposeParkedTerminalWatcherEntry(args.tab.id, currentEntry, mountedPanes)
      return false
    }
  }
  parkedWatchersByTabId.set(args.tab.id, nextEntry)
  if (currentEntry) {
    disposeParkedTerminalWatcherEntry(args.tab.id, currentEntry, mountedPanes)
    parkedWatchersByTabId.set(args.tab.id, nextEntry)
  }
  return true
}
