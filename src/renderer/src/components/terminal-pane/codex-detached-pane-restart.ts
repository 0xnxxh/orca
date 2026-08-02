/**
 * Detached executor for accepted Codex account-switch restarts.
 *
 * Why: queued restarts used to execute only inside mounted TerminalPane
 * instances, so accepting the prompt stranded every unmounted pane — prompt
 * gone, keyboard blocked, Codex still running under the old account until the
 * tab was next revealed. This driver watches pendingCodexPaneRestartIds and
 * kill-and-respawns any pane no mounted transport claims, rebinding the store
 * so a later mount reattaches to the replacement PTY like a restored session.
 */
import { isTerminalLeafId, makePaneKey } from '../../../../shared/stable-pane-id'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import type { TerminalPaneLayoutNode, TerminalTab } from '../../../../shared/types'
import type { AppState } from '@/store'
import { useAppStore } from '@/store'
import { getWorktreeMapFromState } from '@/store/selectors'
import { singlePaneLayoutSnapshot } from '@/store/slices/terminal-helpers'
import { hasRegisteredRuntimeTerminalTab } from '@/runtime/sync-runtime-graph'
import { CODEX_ACCOUNT_RESTART_STARTUP } from '@/lib/codex-session-restart'
import { isForeignMachineCodexPtyId } from '@/lib/codex-pane-selection-lane'
import { getLocalProjectExecutionRuntimeContext } from '@/lib/local-preflight-context'
import {
  getCachedWindowsTerminalCapabilities,
  hasCachedWindowsTerminalCapabilities
} from '@/lib/windows-terminal-capabilities'
import { ptyDataHandlers, unregisterPtyDataHandlers } from './pty-dispatcher'
import { discardPreHandlerPtyState } from './pty-pre-handler-buffer'
import { disposeParkedTerminalWatchersForPtyIds } from './terminal-parked-watcher-registry'

// Why this long: a mounted pane claims its pending restart from a React effect
// in the same commit that observed the queue write, so anything still pending
// after a few frames has no pane coming for it.
const CLAIM_GRACE_MS = 400

let sweepTimer: ReturnType<typeof setTimeout> | null = null
const inFlightPtyIds = new Set<string>()

/** Installed once at app startup; returns the uninstaller (tests). */
export function installCodexDetachedPaneRestartExecutor(): () => void {
  const unsubscribe = useAppStore.subscribe((state, previousState) => {
    if (state.pendingCodexPaneRestartIds === previousState.pendingCodexPaneRestartIds) {
      return
    }
    scheduleClaimSweep()
  })
  return () => {
    unsubscribe()
    if (sweepTimer !== null) {
      clearTimeout(sweepTimer)
      sweepTimer = null
    }
  }
}

export function resetCodexDetachedPaneRestartExecutorForTests(): void {
  if (sweepTimer !== null) {
    clearTimeout(sweepTimer)
    sweepTimer = null
  }
  inFlightPtyIds.clear()
}

function scheduleClaimSweep(): void {
  if (sweepTimer !== null) {
    return
  }
  sweepTimer = setTimeout(() => {
    sweepTimer = null
    void sweepUnclaimedCodexPaneRestarts()
  }, CLAIM_GRACE_MS)
}

export async function sweepUnclaimedCodexPaneRestarts(): Promise<void> {
  for (const ptyId of Object.keys(useAppStore.getState().pendingCodexPaneRestartIds)) {
    // Why: remote-runtime spawns need that machine's transport assembly, which
    // only the mounted pane path carries today; leave those queued for mount.
    if (isForeignMachineCodexPtyId(ptyId)) {
      continue
    }
    // Why: a live primary handler means a mounted pane owns this PTY, and its
    // restart effect re-runs on both the queue write and the transport bind —
    // it is guaranteed to claim, and only it can reconnect the xterm in place.
    if (ptyDataHandlers.has(ptyId) || inFlightPtyIds.has(ptyId)) {
      continue
    }
    const state = useAppStore.getState()
    const located = locateCodexPane(state, ptyId)
    if (!located) {
      // Why not consume: a sleep-retained pending id is unbound on purpose and
      // wake migrates it onto the respawned PTY — taking it here would lose
      // that restart. Only a notice still muting input forces a resolution.
      if (state.codexRestartNoticeByPtyId[ptyId]) {
        if (state.consumePendingCodexPaneRestart(ptyId)) {
          state.clearCodexRestartNotice(ptyId)
        }
      }
      continue
    }
    // Why the registry check too: a revealed tab reads its layout into a ref at
    // mount, before its transports bind (and register a primary handler). A
    // takeover in that window would kill the PTY the pane is attaching to.
    if (hasRegisteredRuntimeTerminalTab(located.tab.id)) {
      continue
    }
    if (!useAppStore.getState().consumePendingCodexPaneRestart(ptyId)) {
      continue
    }
    inFlightPtyIds.add(ptyId)
    try {
      await executeDetachedCodexPaneRestart(located, ptyId)
    } catch (err) {
      console.warn('[codex-restart] detached pane restart failed:', err)
      // Why: the answered-but-unexecuted state is the one this module exists to
      // prevent — put the question back rather than leave a silent input block.
      useAppStore.getState().reopenCodexRestartPrompt(ptyId)
    } finally {
      inFlightPtyIds.delete(ptyId)
    }
  }
}

type LocatedCodexPane = {
  worktreeId: string
  tab: TerminalTab
  leafId: string | null
}

function locateCodexPane(state: AppState, ptyId: string): LocatedCodexPane | null {
  for (const [worktreeId, tabs] of Object.entries(state.tabsByWorktree)) {
    for (const tab of tabs) {
      if (tab.ptyId !== ptyId && !(state.ptyIdsByTabId[tab.id] ?? []).includes(ptyId)) {
        continue
      }
      const leafId =
        Object.entries(state.terminalLayoutsByTabId[tab.id]?.ptyIdsByLeafId ?? {}).find(
          ([, boundPtyId]) => boundPtyId === ptyId
        )?.[0] ?? null
      // Why the format check: pre-UUID layouts carry numeric leaf ids, which the
      // pane-key env and main's binding flush both reject.
      return {
        worktreeId,
        tab,
        leafId: leafId !== null && isTerminalLeafId(leafId) ? leafId : null
      }
    }
  }
  return null
}

function getWorkspacePath(state: AppState, worktreeId: string): string | null {
  const parsed = parseWorkspaceKey(worktreeId)
  if (parsed?.type === 'folder') {
    return (
      (state.folderWorkspaces ?? []).find((workspace) => workspace.id === parsed.folderWorkspaceId)
        ?.folderPath ?? null
    )
  }
  return getWorktreeMapFromState(state).get(worktreeId)?.path ?? null
}

function buildPaneIdentityEnv(
  state: AppState,
  worktreeId: string,
  tabId: string,
  leafId: string
): Record<string, string> {
  const parsed = parseWorkspaceKey(worktreeId)
  const folderWorkspace =
    parsed?.type === 'folder'
      ? state.folderWorkspaces.find((workspace) => workspace.id === parsed.folderWorkspaceId)
      : null
  return {
    ORCA_WORKSPACE_ID: worktreeId,
    ...(folderWorkspace
      ? {
          ORCA_PROJECT_GROUP_ID: folderWorkspace.projectGroupId,
          ORCA_WORKSPACE_ROOT: folderWorkspace.folderPath
        }
      : {}),
    ORCA_PANE_KEY: makePaneKey(tabId, leafId),
    ORCA_TAB_ID: tabId,
    ORCA_WORKTREE_ID: worktreeId
  }
}

async function executeDetachedCodexPaneRestart(
  located: LocatedCodexPane,
  ptyId: string
): Promise<void> {
  const state = useAppStore.getState()
  if (!located.leafId) {
    // Why: without a usable layout leaf the replacement cannot be bound in
    // place, so kill now and let the tab's next mount run the Codex startup.
    await killReplacedCodexPanePty(ptyId)
    const store = useAppStore.getState()
    store.clearTabPtyId(located.tab.id, ptyId)
    store.queueTabStartupCommand(located.tab.id, { ...CODEX_ACCOUNT_RESTART_STARTUP })
    store.clearCodexRestartNotice(ptyId)
    return
  }
  const { worktreeId, tab, leafId } = located

  const size = await window.api.pty.getSize(ptyId).catch(() => null)
  const workspacePath = getWorkspacePath(state, worktreeId)
  const cwd = tab.startupCwd ?? workspacePath ?? undefined
  const capabilities = hasCachedWindowsTerminalCapabilities()
    ? getCachedWindowsTerminalCapabilities()
    : null
  // Why: same runtime context the mounted spawn ships (pty-connection.ts), so a
  // WSL-defaulted project respawns into the same distro it launched from.
  const projectRuntime = getLocalProjectExecutionRuntimeContext(state, worktreeId, undefined, {
    wslAvailable: capabilities?.wslAvailable,
    availableWslDistros: capabilities?.wslDistros ?? null
  })

  const spawned = await window.api.pty.spawn({
    cols: size?.cols ?? 80,
    rows: size?.rows ?? 24,
    ...(cwd ? { cwd } : {}),
    cwdFallback: 'worktree',
    env: buildPaneIdentityEnv(state, worktreeId, tab.id, leafId),
    command: CODEX_ACCOUNT_RESTART_STARTUP.command,
    startupCommandDelivery: CODEX_ACCOUNT_RESTART_STARTUP.startupCommandDelivery,
    launchAgent: CODEX_ACCOUNT_RESTART_STARTUP.launchAgent,
    worktreeId,
    tabId: tab.id,
    leafId,
    ...(tab.shellOverride ? { shellOverride: tab.shellOverride } : {}),
    ...(projectRuntime ? { projectRuntime } : {}),
    initiallyHidden: true
  })

  const store = useAppStore.getState()
  store.updateTabPtyId(tab.id, spawned.id, ptyId)
  if (!useAppStore.getState().ptyIdsByTabId[tab.id]?.includes(spawned.id)) {
    // Why: the tab was retired while the spawn was in flight; without a binding
    // the fresh PTY would idle in the daemon forever, so reap it and stand down.
    store.clearCodexRestartNotice(ptyId)
    await window.api.pty.kill(spawned.id).catch(() => {})
    return
  }
  rebindCodexPaneLayoutLeaf(tab.id, leafId, spawned.id)
  // Why both ids: updateTabPtyId migrates the replaced pane's notice onto the
  // new PTY; the restart it recorded is now done, so the block must lift.
  store.clearCodexRestartNotice(spawned.id)
  store.clearCodexRestartNotice(ptyId)

  await killReplacedCodexPanePty(ptyId)
}

function layoutRootContainsLeaf(
  node: TerminalPaneLayoutNode | null | undefined,
  leafId: string
): boolean {
  if (!node) {
    return false
  }
  if (node.type === 'leaf') {
    return node.leafId === leafId
  }
  return layoutRootContainsLeaf(node.first, leafId) || layoutRootContainsLeaf(node.second, leafId)
}

function rebindCodexPaneLayoutLeaf(tabId: string, leafId: string, newPtyId: string): void {
  const store = useAppStore.getState()
  const layout = store.terminalLayoutsByTabId[tabId]
  const boundLeafIds = Object.keys(layout?.ptyIdsByLeafId ?? {})
  // Why: mount replays panes from the root — a root that doesn't name this leaf
  // mints a fresh one and silently orphans the replacement PTY. Rewriting is
  // only safe when this is the tab's sole bound pane; a split keeps its root.
  if (!layoutRootContainsLeaf(layout?.root, leafId) && boundLeafIds.every((id) => id === leafId)) {
    store.setTabLayout(
      tabId,
      singlePaneLayoutSnapshot(leafId, newPtyId, layout?.titlesByLeafId?.[leafId] ?? null)
    )
    return
  }
  store.replaceTerminalLayoutPanePtyId(tabId, leafId, newPtyId)
}

async function killReplacedCodexPanePty(ptyId: string): Promise<void> {
  // Why the disposal: a parked tab's exit sidecar treats any exit as the pane
  // dying — it would collapse the just-rebound leaf or close the whole tab.
  disposeParkedTerminalWatchersForPtyIds([ptyId])
  useAppStore.getState().suppressPtyExit(ptyId)
  for (const snapshot of unregisterPtyDataHandlers([ptyId])) {
    snapshot.commit()
  }
  try {
    await window.api.pty.kill(ptyId)
  } catch (err) {
    // Why not rethrow: the stale shell can only be reaped, not re-adopted, so a
    // failed kill is log-worthy only — the restart itself already happened.
    console.warn('[codex-restart] failed to kill replaced Codex pane PTY:', err)
  }
  discardPreHandlerPtyState(ptyId)
}
