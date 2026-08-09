import type {
  RuntimeMobileSessionClientTab,
  RuntimeMobileSessionTabsResult
} from '../../shared/runtime-types'
import type { ClientSessionTabSelection } from './client-session-tab-activation'

function topLevelTabId(tab: RuntimeMobileSessionClientTab): string {
  return tab.type === 'terminal' ? tab.parentTabId : tab.id
}

export function omitClosedClientSessionTabs(
  snapshot: RuntimeMobileSessionTabsResult,
  closedTabIds: ReadonlySet<string>,
  pendingActivationTabIds: ReadonlySet<string> = new Set()
): { snapshot: RuntimeMobileSessionTabsResult; retainedClosedTabIds: ReadonlySet<string> } {
  const presentTabIds = new Set([
    ...snapshot.tabs.flatMap((tab) => [tab.id, topLevelTabId(tab)]),
    ...(snapshot.tabGroups?.flatMap((group) => group.tabOrder) ?? [])
  ])
  const retainedClosedTabIds = new Set(
    [...closedTabIds].filter(
      (tabId) => presentTabIds.has(tabId) || pendingActivationTabIds.has(tabId)
    )
  )
  if (retainedClosedTabIds.size === 0) {
    return { snapshot, retainedClosedTabIds }
  }
  const tabs = snapshot.tabs.filter(
    (tab) => !retainedClosedTabIds.has(tab.id) && !retainedClosedTabIds.has(topLevelTabId(tab))
  )
  const tabGroups = snapshot.tabGroups?.map((group) => {
    const tabOrder = group.tabOrder.filter((tabId) => !retainedClosedTabIds.has(tabId))
    return {
      ...group,
      tabOrder,
      activeTabId:
        group.activeTabId && tabOrder.includes(group.activeTabId) ? group.activeTabId : null
    }
  })
  return {
    snapshot: { ...snapshot, tabs, ...(tabGroups ? { tabGroups } : {}) },
    retainedClosedTabIds
  }
}

export function forgetClosedClientSessionTabs(
  selection: ClientSessionTabSelection,
  existingClosedTabIds: ReadonlySet<string>,
  tabIds: readonly string[]
): {
  selection: ClientSessionTabSelection
  closedTabIds: ReadonlySet<string>
  selectionChanged: boolean
} {
  const forgotten = new Set(tabIds)
  const closedTabIds = new Set([...existingClosedTabIds, ...forgotten])
  const activeTabId =
    selection.activeTabId && forgotten.has(selection.activeTabId) ? null : selection.activeTabId
  const activeTabIdByGroupId = Object.fromEntries(
    Object.entries(selection.activeTabIdByGroupId).filter(
      ([, selectedTabId]) => !forgotten.has(selectedTabId)
    )
  )
  return {
    selection: { ...selection, activeTabId, activeTabIdByGroupId },
    closedTabIds,
    selectionChanged:
      activeTabId !== selection.activeTabId ||
      Object.keys(activeTabIdByGroupId).length !==
        Object.keys(selection.activeTabIdByGroupId).length
  }
}

type ClientSessionTabClosureState = {
  // Why: a listed removal cannot clear this while an older materialization can still finish.
  forgottenTabIds: ReadonlySet<string>
  pendingActivationCounts: Map<string, number>
}

export class ClientSessionTabClosureTracker {
  private statesByClient = new Map<string, Map<string, ClientSessionTabClosureState>>()
  // Why: tab destruction is global, including for clients first seen after the close settles.
  private forgottenTabIdsByWorktree = new Map<string, ReadonlySet<string>>()
  // Why: unattributed host activations can also finish after a mobile close.
  private pendingActivationCountsByWorktree = new Map<string, Map<string, number>>()

  private getPendingActivationTabIds(worktreeId: string): ReadonlySet<string> {
    return new Set(this.pendingActivationCountsByWorktree.get(worktreeId)?.keys() ?? [])
  }

  private getState(
    clientNavigationId: string,
    worktreeId: string,
    create = false
  ): ClientSessionTabClosureState | null {
    let statesByWorktree = this.statesByClient.get(clientNavigationId)
    if (!statesByWorktree && create) {
      statesByWorktree = new Map()
      this.statesByClient.set(clientNavigationId, statesByWorktree)
    }
    let state = statesByWorktree?.get(worktreeId)
    if (!state && create) {
      state = { forgottenTabIds: new Set(), pendingActivationCounts: new Map() }
      statesByWorktree?.set(worktreeId, state)
    }
    return state ?? null
  }

  private pruneState(clientNavigationId: string, worktreeId: string): void {
    const statesByWorktree = this.statesByClient.get(clientNavigationId)
    const state = statesByWorktree?.get(worktreeId)
    if (state && state.forgottenTabIds.size === 0 && state.pendingActivationCounts.size === 0) {
      statesByWorktree?.delete(worktreeId)
    }
    if (statesByWorktree?.size === 0) {
      this.statesByClient.delete(clientNavigationId)
    }
  }

  project(
    snapshot: RuntimeMobileSessionTabsResult,
    clientNavigationId?: string
  ): RuntimeMobileSessionTabsResult {
    const globallyForgottenTabIds = this.forgottenTabIdsByWorktree.get(snapshot.worktree)
    if (globallyForgottenTabIds) {
      const globallyClosed = omitClosedClientSessionTabs(
        snapshot,
        globallyForgottenTabIds,
        this.getPendingActivationTabIds(snapshot.worktree)
      )
      if (globallyClosed.retainedClosedTabIds.size === 0) {
        this.forgottenTabIdsByWorktree.delete(snapshot.worktree)
      } else {
        this.forgottenTabIdsByWorktree.set(snapshot.worktree, globallyClosed.retainedClosedTabIds)
      }
      snapshot = globallyClosed.snapshot
    }
    if (!clientNavigationId) {
      return snapshot
    }
    const state = this.getState(clientNavigationId, snapshot.worktree)
    if (!state) {
      return snapshot
    }
    const closed = omitClosedClientSessionTabs(
      snapshot,
      state.forgottenTabIds,
      new Set(state.pendingActivationCounts.keys())
    )
    state.forgottenTabIds = closed.retainedClosedTabIds
    this.pruneState(clientNavigationId, snapshot.worktree)
    return closed.snapshot
  }

  forgetTabsGlobally(worktreeId: string, tabIds: readonly string[]): void {
    this.forgottenTabIdsByWorktree.set(
      worktreeId,
      new Set([...(this.forgottenTabIdsByWorktree.get(worktreeId) ?? []), ...tabIds])
    )
  }

  forgetTabs(
    clientNavigationId: string,
    worktreeId: string,
    selection: ClientSessionTabSelection | undefined,
    tabIds: readonly string[]
  ): ReturnType<typeof forgetClosedClientSessionTabs> & { closureChanged: boolean } {
    const state = this.getState(clientNavigationId, worktreeId, true)!
    const previousClosureSize = state.forgottenTabIds.size
    const closed = forgetClosedClientSessionTabs(
      selection ?? { activeTabId: null, activeGroupId: null, activeTabIdByGroupId: {} },
      state.forgottenTabIds,
      tabIds
    )
    state.forgottenTabIds = closed.closedTabIds
    return { ...closed, closureChanged: closed.closedTabIds.size !== previousClosureSize }
  }

  forgetPendingActivations(worktreeId: string, tabIds: readonly string[]): void {
    const forgotten = new Set(tabIds)
    for (const statesByWorktree of this.statesByClient.values()) {
      const state = statesByWorktree.get(worktreeId)
      if (state && [...forgotten].some((tabId) => state.pendingActivationCounts.has(tabId))) {
        state.forgottenTabIds = new Set([...state.forgottenTabIds, ...forgotten])
      }
    }
  }

  beginActivation(
    clientNavigationId: string | undefined,
    worktreeId: string,
    tabIds: readonly string[]
  ): void {
    const pendingCounts =
      this.pendingActivationCountsByWorktree.get(worktreeId) ?? new Map<string, number>()
    for (const tabId of new Set(tabIds)) {
      pendingCounts.set(tabId, (pendingCounts.get(tabId) ?? 0) + 1)
    }
    this.pendingActivationCountsByWorktree.set(worktreeId, pendingCounts)
    if (!clientNavigationId) {
      return
    }
    const state = this.getState(clientNavigationId, worktreeId, true)!
    for (const tabId of new Set(tabIds)) {
      state.pendingActivationCounts.set(tabId, (state.pendingActivationCounts.get(tabId) ?? 0) + 1)
    }
  }

  finishActivation(
    clientNavigationId: string | undefined,
    worktreeId: string,
    snapshot: RuntimeMobileSessionTabsResult | undefined,
    tabIds: readonly string[]
  ): void {
    const pendingCounts = this.pendingActivationCountsByWorktree.get(worktreeId)
    for (const tabId of new Set(tabIds)) {
      const count = pendingCounts?.get(tabId) ?? 0
      if (count <= 1) {
        pendingCounts?.delete(tabId)
      } else {
        pendingCounts?.set(tabId, count - 1)
      }
    }
    if (pendingCounts?.size === 0) {
      this.pendingActivationCountsByWorktree.delete(worktreeId)
    }
    if (clientNavigationId) {
      const state = this.getState(clientNavigationId, worktreeId)
      if (state) {
        for (const tabId of new Set(tabIds)) {
          const count = state.pendingActivationCounts.get(tabId) ?? 0
          if (count <= 1) {
            state.pendingActivationCounts.delete(tabId)
          } else {
            state.pendingActivationCounts.set(tabId, count - 1)
          }
        }
      }
    }
    if (snapshot) {
      this.project(snapshot, clientNavigationId)
    } else if (clientNavigationId) {
      this.pruneState(clientNavigationId, worktreeId)
    }
  }

  isForgotten(clientNavigationId: string | undefined, worktreeId: string, tabId: string): boolean {
    return (
      this.forgottenTabIdsByWorktree.get(worktreeId)?.has(tabId) === true ||
      (clientNavigationId !== undefined &&
        this.getState(clientNavigationId, worktreeId)?.forgottenTabIds.has(tabId) === true)
    )
  }

  migrateWorktree(oldWorktreeId: string, newWorktreeId: string): void {
    if (oldWorktreeId === newWorktreeId) {
      return
    }
    const oldForgottenTabIds = this.forgottenTabIdsByWorktree.get(oldWorktreeId)
    if (oldForgottenTabIds) {
      this.forgottenTabIdsByWorktree.set(
        newWorktreeId,
        new Set([
          ...(this.forgottenTabIdsByWorktree.get(newWorktreeId) ?? []),
          ...oldForgottenTabIds
        ])
      )
      this.forgottenTabIdsByWorktree.delete(oldWorktreeId)
    }
    const oldPendingActivationCounts = this.pendingActivationCountsByWorktree.get(oldWorktreeId)
    if (oldPendingActivationCounts) {
      const pendingActivationCounts = new Map(
        this.pendingActivationCountsByWorktree.get(newWorktreeId)
      )
      for (const [tabId, count] of oldPendingActivationCounts) {
        pendingActivationCounts.set(tabId, (pendingActivationCounts.get(tabId) ?? 0) + count)
      }
      this.pendingActivationCountsByWorktree.set(newWorktreeId, pendingActivationCounts)
      this.pendingActivationCountsByWorktree.delete(oldWorktreeId)
    }
    for (const [clientNavigationId, statesByWorktree] of this.statesByClient) {
      const oldState = statesByWorktree.get(oldWorktreeId)
      if (!oldState) {
        continue
      }
      const newState = statesByWorktree.get(newWorktreeId)
      if (newState) {
        const pendingActivationCounts = new Map(newState.pendingActivationCounts)
        for (const [tabId, count] of oldState.pendingActivationCounts) {
          pendingActivationCounts.set(tabId, (pendingActivationCounts.get(tabId) ?? 0) + count)
        }
        statesByWorktree.set(newWorktreeId, {
          forgottenTabIds: new Set([...newState.forgottenTabIds, ...oldState.forgottenTabIds]),
          pendingActivationCounts
        })
      } else {
        statesByWorktree.set(newWorktreeId, oldState)
      }
      statesByWorktree.delete(oldWorktreeId)
      this.pruneState(clientNavigationId, oldWorktreeId)
    }
  }

  forgetClient(clientNavigationId: string): void {
    const statesByWorktree = this.statesByClient.get(clientNavigationId)
    for (const [worktreeId, state] of statesByWorktree ?? []) {
      if (state.pendingActivationCounts.size === 0) {
        statesByWorktree?.delete(worktreeId)
      }
    }
    if (statesByWorktree?.size === 0) {
      this.statesByClient.delete(clientNavigationId)
    }
  }
}
