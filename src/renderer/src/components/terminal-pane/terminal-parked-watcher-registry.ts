/**
 * Parked terminal watcher registry (store-free bookkeeping).
 *
 * Why a separate module: shutdownWorktreeTerminals (a store slice) must
 * synchronously dispose parked watchers, but the watcher lifecycle module
 * imports the store — a slice importing it would re-enter store creation
 * mid-evaluation. Keeping the maps and pure disposal here lets the slice
 * import cycle-free, mirroring how pty-dispatcher exports its handler maps.
 */
import { discardPreHandlerPtyState } from './pty-pre-handler-buffer'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import type { PtyMutationIdentity } from '../../../../shared/pty-mutation-identity'
import type { ParkedTerminalSideEffectIdentity } from './terminal-parked-side-effect-identity'

export type ParkedTerminalPaneCapture = {
  ptyId: string | null
  mutationIdentity?: PtyMutationIdentity
  sideEffectIdentity?: ParkedTerminalSideEffectIdentity
  /** PaneManager numeric pane id the live pane used for runtime titles. */
  paneId: number
  /** Stable terminal-layout leaf UUID (paneKey attribution). */
  leafId: string
  drivesTabTitle: boolean
}

export type CapturedTabPanes = { worktreeId: string; panes: ParkedTerminalPaneCapture[] }

export const capturedPanesByTabId = new Map<string, CapturedTabPanes>()

type MountedPaneCandidateReaderEntry = {
  worktreeId: string
  read: () => ParkedTerminalPaneCapture[]
}

const mountedPaneCandidateReadersByTabId = new Map<string, MountedPaneCandidateReaderEntry>()

export function registerMountedTerminalPaneCandidateReader(
  tabId: string,
  worktreeId: string,
  read: () => ParkedTerminalPaneCapture[]
): () => void {
  const entry = { worktreeId, read }
  mountedPaneCandidateReadersByTabId.set(tabId, entry)
  return () => {
    if (mountedPaneCandidateReadersByTabId.get(tabId) === entry) {
      mountedPaneCandidateReadersByTabId.delete(tabId)
    }
  }
}

export function readMountedTerminalPaneCandidates(
  tabId: string,
  worktreeId: string
): ParkedTerminalPaneCapture[] | null {
  const entry = mountedPaneCandidateReadersByTabId.get(tabId)
  if (!entry || entry.worktreeId !== worktreeId) {
    return null
  }
  try {
    return entry.read().map((pane) => ({ ...pane }))
  } catch {
    return null
  }
}

// Why: PaneManager pane ids die with the unmounted pane, but the watcher must
// keep writing the exact runtime-title slots the live pane used — a different
// slot would strand a stale "working" title that pins worktree status.
// TerminalPane unmount records the identities here for the park wiring.
export function captureParkedTerminalPaneCandidates(
  tabId: string,
  worktreeId: string,
  panes: ParkedTerminalPaneCapture[]
): void {
  capturedPanesByTabId.set(tabId, { worktreeId, panes })
}

export type ParkedTabWatcherEntry = {
  worktreeId: string
  /** Tab-level ptyId at watcher start; a change means the PTY was re-minted
   *  (e.g. wake respawn) and the watchers must restart against fresh ids. */
  tabPtyId: string | null
  phase?: 'prepared' | 'parked'
  preparationValid?: boolean
  usesDurableCandidates?: boolean
  paneCaptureByPtyId?: Map<string, ParkedTerminalPaneCapture>
  suspendedPtyIds?: Set<string>
  /** Runtime-title slot each watcher writes, so parked PTY-exit handling can
   *  clear the dead leaf's slot (no live pane will ever overwrite it). */
  paneIdByPtyId: Map<string, number>
  activateByPtyId?: Map<string, () => boolean>
  disposersByPtyId: Map<string, (options?: ParkedWatcherDisposeOptions) => void>
  revealReplacementAttemptByPtyId?: Map<string, number>
  retainedRevealPtyIds?: Set<string>
}

export type ParkedWatcherDisposeOptions = { preserveRuntimeTitle?: boolean }

export type PhasedParkedTabWatcherEntry = ParkedTabWatcherEntry & {
  phase: 'prepared' | 'parked'
  preparationValid: boolean
  usesDurableCandidates: boolean
  paneCaptureByPtyId: Map<string, ParkedTerminalPaneCapture>
  suspendedPtyIds: Set<string>
  activateByPtyId: Map<string, () => boolean>
  revealReplacementAttemptByPtyId: Map<string, number>
  retainedRevealPtyIds: Set<string>
}

export function ensurePhasedParkedTabWatcherEntry(
  entry: ParkedTabWatcherEntry
): PhasedParkedTabWatcherEntry {
  entry.phase ??= 'parked'
  entry.preparationValid ??= true
  entry.usesDurableCandidates ??= true
  entry.paneCaptureByPtyId ??= new Map()
  entry.suspendedPtyIds ??= new Set()
  entry.activateByPtyId ??= new Map()
  entry.revealReplacementAttemptByPtyId ??= new Map()
  entry.retainedRevealPtyIds ??= new Set()
  return entry as PhasedParkedTabWatcherEntry
}

export const parkedWatchersByTabId = new Map<string, ParkedTabWatcherEntry>()
let nextRevealReplacementAttempt = 0

export type ParkedTerminalWatcherReplacement = {
  commit: (installSuccessor: () => boolean) => boolean
  abort: () => void
}

/** Keep the parked owner live until a revealed pane proves its replacement binding. */
export function beginParkedTerminalWatcherReplacement(
  tabId: string,
  ptyId: string
): ParkedTerminalWatcherReplacement | null {
  const registeredEntry = parkedWatchersByTabId.get(tabId)
  if (!registeredEntry) {
    return null
  }
  const entry = ensurePhasedParkedTabWatcherEntry(registeredEntry)
  if (entry.phase !== 'parked' || !entry.disposersByPtyId.has(ptyId)) {
    return null
  }
  nextRevealReplacementAttempt += 1
  const attempt = nextRevealReplacementAttempt
  entry.revealReplacementAttemptByPtyId.set(ptyId, attempt)
  entry.retainedRevealPtyIds.add(ptyId)

  const isCurrent = (): boolean =>
    parkedWatchersByTabId.get(tabId) === entry &&
    entry.revealReplacementAttemptByPtyId.get(ptyId) === attempt

  return {
    commit(installSuccessor): boolean {
      if (!isCurrent() || !installSuccessor()) {
        return false
      }
      entry.revealReplacementAttemptByPtyId.delete(ptyId)
      entry.retainedRevealPtyIds.delete(ptyId)
      const dispose = entry.disposersByPtyId.get(ptyId)
      entry.disposersByPtyId.delete(ptyId)
      entry.activateByPtyId.delete(ptyId)
      entry.suspendedPtyIds.delete(ptyId)
      dispose?.({ preserveRuntimeTitle: true })
      if (entry.disposersByPtyId.size === 0 && parkedWatchersByTabId.get(tabId) === entry) {
        parkedWatchersByTabId.delete(tabId)
      }
      return true
    },
    abort(): void {
      if (isCurrent()) {
        entry.revealReplacementAttemptByPtyId.delete(ptyId)
      }
    }
  }
}

export function getParkedTerminalWatcherTabIds(): string[] {
  return Array.from(parkedWatchersByTabId.keys())
}

// Why: the floating workspace is synthetic, so repo/folder surface lists never include it.
export function terminalWatcherLiveWorkspaceIds(workspaceIds: Iterable<string>): Set<string> {
  return new Set([...workspaceIds, FLOATING_TERMINAL_WORKTREE_ID])
}

/**
 * Whether this tab is parked right now — the reveal remount's own mount effect
 * runs before the host effect that disposes the watcher (child effects first),
 * so a pane reading this at connect time can tell a park-reveal from an
 * in-place reattach. Empty entries are pending-close tombstones, not live parks.
 */
export function isTerminalTabParked(tabId: string): boolean {
  const entry = parkedWatchersByTabId.get(tabId)
  return entry !== undefined && entry.phase !== 'prepared' && entry.disposersByPtyId.size > 0
}

export function disposeParkedTabWatchers(
  tabId: string,
  options?: ParkedWatcherDisposeOptions
): void {
  const entry = parkedWatchersByTabId.get(tabId)
  if (!entry) {
    return
  }
  parkedWatchersByTabId.delete(tabId)
  for (const dispose of entry.disposersByPtyId.values()) {
    dispose(options)
  }
  entry.activateByPtyId?.clear()
  entry.disposersByPtyId.clear()
  entry.suspendedPtyIds?.clear()
  entry.revealReplacementAttemptByPtyId?.clear()
  entry.retainedRevealPtyIds?.clear()
}

export function retireParkedTerminalTab(tabId: string): void {
  // Why: explicit tab retirement permanently invalidates both live parked
  // observers and unmounted-pane candidates; neither may reattach later.
  disposeParkedTabWatchers(tabId)
  capturedPanesByTabId.delete(tabId)
  mountedPaneCandidateReadersByTabId.delete(tabId)
}

/**
 * Synchronously disposes any parked watcher subscribed to these PTYs.
 * Shutdown transactionally suspends dispatcher sidecars before teardown, then
 * disposes their watchers only after commit. The tab entries remain so a
 * sleeping parked tab cannot restart against stale PTY ids; wake re-mints the
 * ids and the sync path restarts watchers then.
 */
export function disposeParkedTerminalWatchersForPtyIds(ptyIds: readonly string[]): void {
  for (const entry of parkedWatchersByTabId.values()) {
    for (const ptyId of ptyIds) {
      const dispose = entry.disposersByPtyId.get(ptyId)
      if (dispose) {
        entry.disposersByPtyId.delete(ptyId)
        entry.activateByPtyId?.delete(ptyId)
        entry.suspendedPtyIds?.add(ptyId)
        entry.revealReplacementAttemptByPtyId?.delete(ptyId)
        entry.retainedRevealPtyIds?.delete(ptyId)
        dispose()
      }
    }
  }
}

export function disposeParkedTerminalWatchersForWorktree(
  worktreeId: string,
  options?: { consumePreHandlerState?: boolean }
): void {
  for (const [tabId, entry] of parkedWatchersByTabId) {
    if (entry.worktreeId === worktreeId) {
      if (options?.consumePreHandlerState) {
        disposeRemovedWorktreeParkedTabWatchers(tabId, entry)
      } else {
        disposeParkedTabWatchers(tabId)
      }
    }
  }
}

export function disposeRemovedWorktreeParkedTerminalWatchers(
  worktreeId: string,
  authoritativePtyIds: readonly string[] = []
): void {
  for (const ptyId of authoritativePtyIds) {
    discardPreHandlerPtyState(ptyId)
  }
  disposeParkedTerminalWatchersForWorktree(worktreeId, { consumePreHandlerState: true })
}

export function disposeAllParkedTerminalWatchers(): void {
  for (const tabId of Array.from(parkedWatchersByTabId.keys())) {
    disposeParkedTabWatchers(tabId)
  }
}

function disposeRemovedWorktreeParkedTabWatchers(
  tabId: string,
  entry: ParkedTabWatcherEntry
): void {
  // Why: removal unregisters sidecars before PTY kill finishes. Tombstone each
  // old PTY now so its delayed final flush/exit cannot refill bounded buffers
  // after this worktree loses every future pane consumer.
  for (const ptyId of entry.paneIdByPtyId.keys()) {
    discardPreHandlerPtyState(ptyId)
  }
  disposeParkedTabWatchers(tabId)
}

/** Drops watchers and captures for worktrees that no longer exist. */
export function pruneParkedTerminalWatchers(liveWorktreeIds: ReadonlySet<string>): void {
  for (const [tabId, entry] of parkedWatchersByTabId) {
    if (!liveWorktreeIds.has(entry.worktreeId)) {
      disposeRemovedWorktreeParkedTabWatchers(tabId, entry)
    }
  }
  for (const [tabId, capture] of capturedPanesByTabId) {
    if (!liveWorktreeIds.has(capture.worktreeId)) {
      capturedPanesByTabId.delete(tabId)
    }
  }
  for (const [tabId, reader] of mountedPaneCandidateReadersByTabId) {
    if (!liveWorktreeIds.has(reader.worktreeId)) {
      mountedPaneCandidateReadersByTabId.delete(tabId)
    }
  }
}
