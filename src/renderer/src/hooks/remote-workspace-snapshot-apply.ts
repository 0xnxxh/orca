import type { StoreApi } from 'zustand'
import type { RemoteWorkspaceSnapshot } from '../../../shared/remote-workspace-types'
import { importRemoteWorkspaceSession } from '../../../shared/remote-workspace-session-projection'
import type { DirectSshAuthority } from '../../../shared/ssh-types'
import { translate } from '@/i18n/i18n'
import { buildWorkspaceSessionPayload } from '../lib/workspace-session'
import { resolveDirectSshTargetScope } from '../lib/direct-ssh-target-scope'
import type { AppState } from '../store/types'
import {
  admitDirectSshSnapshotApplyToken,
  type DirectSshPreparationToken,
  type DirectSshSnapshotApplyToken
} from './direct-ssh-reconnect-coordinator'
import { directSshAuthoritiesEqual } from './direct-ssh-reconnect-tokens'
import {
  mergeDirectSshRemoteWorkspaceSession,
  uniqueWorktreeIdByPath
} from './remote-workspace-session-merge'

const REMOTE_WORKSPACE_SNAPSHOT_WRITE_SUPPRESS_MS = 1_000
const SNAPSHOT_TERMINAL_RECONNECT_TIMEOUT_MS = 30_000
let snapshotApplyDepth = 0
let snapshotWriteSuppressUntil = 0

export function isDirectSshRemoteWorkspaceApplyInProgress(): boolean {
  return snapshotApplyDepth > 0 || Date.now() < snapshotWriteSuppressUntil
}

type RemoteWorkspaceSnapshotApplyInput = {
  store: Pick<StoreApi<AppState>, 'getState'>
  snapshot: RemoteWorkspaceSnapshot
  token: DirectSshSnapshotApplyToken
  arrival: number
  isArrivalCurrent: (targetId: string, arrival: number) => boolean
  isPreparationTokenCurrent: (token: DirectSshPreparationToken) => boolean
  waitForWorkspaceSessionReady: () => Promise<boolean>
  finalizeHydratedTerminals: (authority: DirectSshAuthority) => number
}

function exactTargetWorktreeIds(state: AppState, authority: DirectSshAuthority): Set<string> {
  return resolveDirectSshTargetScope({
    targetId: authority.targetId,
    catalogRevision: 0,
    repos: state.repos,
    worktreesByRepo: state.worktreesByRepo,
    detectedWorktreesByRepo: state.detectedWorktreesByRepo,
    folderWorkspaces: state.folderWorkspaces,
    projectGroups: state.projectGroups,
    restoredRuntimeHostIdByWorkspaceSessionKey: state.restoredRuntimeHostIdByWorkspaceSessionKey
  }).gitWorktreeIds
}

function currentRecoveryTabIds(
  state: AppState,
  authority: DirectSshAuthority,
  worktreeIds: ReadonlySet<string>
): Set<string> {
  const targetTabIds = new Set(
    [...worktreeIds].flatMap((worktreeId) =>
      (state.tabsByWorktree[worktreeId] ?? []).map((tab) => tab.id)
    )
  )
  return new Set(
    [
      ...Object.entries(state.directSshPaneRetryByTabId),
      ...Object.entries(state.directSshLivePtyBindingByTabId)
    ]
      .filter(
        ([tabId, entry]) =>
          targetTabIds.has(tabId) && directSshAuthoritiesEqual(entry.authority, authority)
      )
      .map(([tabId]) => tabId)
  )
}

export async function applyDirectSshRemoteWorkspaceSnapshot({
  store,
  snapshot,
  token,
  arrival,
  isArrivalCurrent,
  isPreparationTokenCurrent,
  waitForWorkspaceSessionReady,
  finalizeHydratedTerminals
}: RemoteWorkspaceSnapshotApplyInput): Promise<void> {
  const { authority } = token
  if (!isArrivalCurrent(authority.targetId, arrival)) {
    return
  }
  if (
    !isPreparationTokenCurrent(token) ||
    !admitDirectSshSnapshotApplyToken(token, authority, snapshot.revision)
  ) {
    return
  }
  if (!(await waitForWorkspaceSessionReady())) {
    if (isArrivalCurrent(authority.targetId, arrival) && isPreparationTokenCurrent(token)) {
      store.getState().setRemoteWorkspaceSyncStatus(authority.targetId, {
        phase: 'error',
        direction: 'pull',
        message: translate(
          'auto.hooks.useIpcEvents.88214a785b',
          'Workspace sync waited for local session hydration and timed out'
        )
      })
    }
    return
  }
  const state = store.getState()
  const worktreeIds = exactTargetWorktreeIds(state, authority)
  const remoteSession = importRemoteWorkspaceSession(snapshot.session, {
    resolveWorktreeId: uniqueWorktreeIdByPath(worktreeIds)
  })
  const merged = mergeDirectSshRemoteWorkspaceSession(
    buildWorkspaceSessionPayload(state),
    remoteSession,
    worktreeIds,
    state.tabsByWorktree,
    currentRecoveryTabIds(state, authority, worktreeIds)
  )
  if (!isArrivalCurrent(authority.targetId, arrival) || !isPreparationTokenCurrent(token)) {
    return
  }
  snapshotApplyDepth += 1
  try {
    const currentStore = store.getState()
    const replaceWorkspaceKeys = [...worktreeIds]
    currentStore.hydrateWorkspaceSession(merged, {
      directSshAuthority: authority,
      replaceWorkspaceKeys
    })
    currentStore.hydrateTabsSession(merged, { replaceWorkspaceKeys })
    // KNOWN DEFECT, deliberately not repaired here (STA-3077 follow-up).
    //
    // A remote snapshot is terminal-only: `RemoteWorkspaceSession` has no `unifiedTabs` or
    // `tabGroups` field to carry, so replacing `tabsByWorktree` leaves the tab model inconsistent
    // in BOTH directions — remote tabs that no group's `tabOrder` names, and group entries naming
    // a local tab whose record the replace removed. The tab bar renders from `tabOrder`, so those
    // tabs exist and are invisible. Same user-visible symptom as the partition-upgrade bug, but
    // reachable with no partition at all: a fresh client, a reset profile, or tabs created from
    // another client. The load-time partition hoist does NOT cover it.
    //
    // `reconcileWorktreeTabModel` already adopts reconnectable records and prunes unrenderable
    // ones, and calling it here is the obvious fix — but doing so breaks
    // "converges the active-terminal repair instead of re-running it forever", i.e. it reopens a
    // repair loop. Any fix has to converge; the durable answer is probably to teach the snapshot
    // to carry the group model, which is a capability-negotiated wire change.
    //
    // Why: direct SSH snapshots project terminal state only; global editor/browser hydration would reset unrelated hosts.
    currentStore.markRemoteWorkspaceHydrated(authority.targetId)
    currentStore.setRemoteWorkspaceSyncStatus(authority.targetId, {
      phase: 'synced',
      direction: 'pull',
      revision: snapshot.revision,
      updatedAt: snapshot.updatedAt,
      lastSyncedAt: Date.now(),
      message: translate('auto.hooks.useIpcEvents.4f78ba5885', 'Workspace synced')
    })
    const reconnectAbort = new AbortController()
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    await Promise.race([
      Promise.resolve()
        .then(() =>
          store.getState().reconnectPersistedTerminals(reconnectAbort.signal, {
            directSshAuthority: authority,
            workspaceKeys: replaceWorkspaceKeys
          })
        )
        .catch(() => {}),
      new Promise<void>((resolve) => {
        reconnectTimer = setTimeout(() => {
          reconnectAbort.abort()
          resolve()
        }, SNAPSHOT_TERMINAL_RECONNECT_TIMEOUT_MS)
      })
    ])
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
    }
    if (isArrivalCurrent(authority.targetId, arrival) && isPreparationTokenCurrent(token)) {
      finalizeHydratedTerminals(authority)
      // KNOWN DEFECT, still open (STA-3077 follow-up). A snapshot is terminal-only —
      // `RemoteWorkspaceSession` cannot carry `unifiedTabs`/`tabGroups` — so replacing
      // `tabsByWorktree` leaves tabs no group's `tabOrder` names, and the tab bar renders from
      // `tabOrder`. Those tabs exist and are invisible. Same symptom as the partition-upgrade bug,
      // reachable with no partition at all.
      //
      // `reconcileWorktreeTabModel(worktreeId)` for each replaced key fixes it and converges — but
      // it also DELETES the tabs whenever `reconnectPersistedTerminals` binds no PTY. That is
      // reachable: the reconnect races a 30s timeout that aborts, and its rejection path is
      // swallowed, so both fall through to here. `hydrateWorkspaceSession` seeds
      // `deferredSshSessionIdsByTabId` only when the target is NOT connected, which is exactly
      // this case, so `terminalTabHasReconnectablePty` sees nothing and the orphan sweep wipes
      // every worktree in `replaceWorkspaceKeys` — including background ones the user never
      // opened. Losing tabs on a slow reconnect is worse than tabs that need a click to reappear.
      //
      // A fix must gate on reconnect having actually bound something, and needs a test for the
      // failed-reconnect path, which nothing covers today.
    }
  } finally {
    snapshotWriteSuppressUntil = Date.now() + REMOTE_WORKSPACE_SNAPSHOT_WRITE_SUPPRESS_MS
    snapshotApplyDepth -= 1
  }
}
