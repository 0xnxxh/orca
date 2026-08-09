import type {
  RuntimeMobileSessionClientTab,
  RuntimeMobileSessionTabsResult
} from '../../shared/runtime-types'
import type { PersistedMobileClientTabSelections } from '../../shared/types'
import {
  activateClientSessionTabSelection,
  type ClientSessionTabSelection
} from './client-session-tab-activation'
import {
  ClientSessionTabActivationIntentTracker,
  type ClientSessionTabActivationIntent
} from './client-session-tab-activation-intent'
import { ClientSessionTabClosureTracker } from './client-session-tab-closure'
import { projectClientSessionTabSelection } from './client-session-tab-projection'
import { normalizePersistedMobileClientTabSelections } from './client-session-tab-selection-persistence'
import { ClientSessionWorktreeAliases } from './client-session-worktree-aliases'

export {
  activateClientSessionTabSelection,
  deriveClientSessionTabSelection
} from './client-session-tab-activation'
export type { ClientSessionTabSelection } from './client-session-tab-activation'

export type { ClientSessionTabActivationIntent } from './client-session-tab-activation-intent'
export { projectClientSessionTabSelection } from './client-session-tab-projection'

export type ClientSessionTabClosureIntent = ReadonlyMap<
  string,
  ClientSessionTabActivationIntent | undefined
>

type StoredClientSessionTabSelection = {
  selection: ClientSessionTabSelection
  revision: number
  // Why: listAll projects every worktree; only hydrated or user-activated selections belong on disk.
  shouldPersist: boolean
}

function emptyClientSessionTabSelection(): ClientSessionTabSelection {
  return { activeTabId: null, activeGroupId: null, activeTabIdByGroupId: {} }
}

function topLevelTabId(tab: RuntimeMobileSessionClientTab): string {
  if (tab.type === 'terminal') {
    return tab.parentTabId
  }
  return tab.id
}

export class ClientSessionTabSelectionStore {
  private statesByClient = new Map<string, Map<string, StoredClientSessionTabSelection>>()
  // Why: delayed tab operations still carry pre-rename identities.
  private worktreeAliases = new ClientSessionWorktreeAliases()
  private activationIntents = new ClientSessionTabActivationIntentTracker()
  private tabClosures = new ClientSessionTabClosureTracker()
  private persistListener: ((state: PersistedMobileClientTabSelections) => void) | null = null

  // Why: selections previously died with the process, so a host restart snapped every phone back to the first tab (deterministic-topology fallback).
  hydrate(persisted: PersistedMobileClientTabSelections): void {
    for (const [clientNavigationId, selectionsByWorktree] of Object.entries(
      normalizePersistedMobileClientTabSelections(persisted)
    )) {
      const statesByWorktree = this.getStatesByWorktree(clientNavigationId)
      for (const [worktreeId, selection] of Object.entries(selectionsByWorktree)) {
        statesByWorktree.set(worktreeId, {
          selection,
          revision: 0,
          shouldPersist: true
        })
      }
    }
  }

  setPersistListener(listener: (state: PersistedMobileClientTabSelections) => void): void {
    this.persistListener = listener
  }

  serialize(): PersistedMobileClientTabSelections {
    const persisted: PersistedMobileClientTabSelections = {}
    for (const [clientNavigationId, statesByWorktree] of this.statesByClient) {
      const entries: Record<string, ClientSessionTabSelection> = {}
      for (const [worktreeId, state] of statesByWorktree) {
        if (state.shouldPersist) {
          entries[worktreeId] = state.selection
        }
      }
      if (Object.keys(entries).length > 0) {
        persisted[clientNavigationId] = entries
      }
    }
    return persisted
  }

  private persistNow(): void {
    this.persistListener?.(this.serialize())
  }

  private getStatesByWorktree(
    clientNavigationId: string
  ): Map<string, StoredClientSessionTabSelection> {
    let statesByWorktree = this.statesByClient.get(clientNavigationId)
    if (!statesByWorktree) {
      statesByWorktree = new Map()
      this.statesByClient.set(clientNavigationId, statesByWorktree)
    }
    return statesByWorktree
  }

  private resolveWorktreeId(worktreeId: string): string {
    return this.worktreeAliases.resolve(worktreeId)
  }

  project(
    snapshot: RuntimeMobileSessionTabsResult,
    clientNavigationId?: string
  ): RuntimeMobileSessionTabsResult {
    if (!clientNavigationId) {
      return snapshot
    }
    const statesByWorktree = this.getStatesByWorktree(clientNavigationId)
    const state = statesByWorktree.get(snapshot.worktree) ?? {
      // Why: host focus is private navigation; a new paired device starts from deterministic topology instead of inheriting it.
      selection: emptyClientSessionTabSelection(),
      revision: 0,
      shouldPersist: false
    }
    const closedSnapshot = this.tabClosures.project(snapshot, clientNavigationId)
    if (snapshot.tabs.length === 0) {
      // Why: an empty snapshot has no topology to project; writing it back would wipe a restart-hydrated selection before tabs arrive.
      return {
        ...closedSnapshot,
        publicationEpoch: `${snapshot.publicationEpoch}:client-navigation`,
        snapshotVersion: snapshot.snapshotVersion + state.revision
      }
    }
    const projected = projectClientSessionTabSelection(closedSnapshot, state.selection)
    // Why: a browser guest process swap drops its tab for one snapshot; the topology fallback
    // must not overwrite (and persist) the device's explicit pick, or focus never returns.
    const selectionSurvived =
      !state.selection.activeTabId ||
      snapshot.tabs.some((tab) => tab.id === state.selection.activeTabId)
    if (selectionSurvived) {
      statesByWorktree.set(snapshot.worktree, {
        selection: projected.selection,
        revision: state.revision,
        shouldPersist: state.shouldPersist
      })
    }
    return {
      ...projected.snapshot,
      publicationEpoch: `${snapshot.publicationEpoch}:client-navigation`,
      snapshotVersion: snapshot.snapshotVersion + state.revision
    }
  }

  activate(
    snapshot: RuntimeMobileSessionTabsResult,
    clientNavigationId: string,
    activeTabId: string,
    activationIntent?: ClientSessionTabActivationIntent
  ): RuntimeMobileSessionTabsResult {
    const activeTab = snapshot.tabs.find((tab) => tab.id === activeTabId)
    const activationTabIds = activeTab ? [activeTabId, topLevelTabId(activeTab)] : [activeTabId]
    if (!this.activationIntents.claim(clientNavigationId, activationIntent, activationTabIds)) {
      return this.project(snapshot, clientNavigationId)
    }
    const statesByWorktree = this.getStatesByWorktree(clientNavigationId)
    const state = statesByWorktree.get(snapshot.worktree) ?? {
      selection: emptyClientSessionTabSelection(),
      revision: 0,
      shouldPersist: false
    }
    // Why: a delayed activation can finish after close; absence must retire the tombstone first.
    if (
      !activeTab ||
      this.tabClosures.isForgotten(clientNavigationId, snapshot.worktree, activeTabId) ||
      this.tabClosures.isForgotten(clientNavigationId, snapshot.worktree, topLevelTabId(activeTab))
    ) {
      return this.project(snapshot, clientNavigationId)
    }
    const nextSelection = activateClientSessionTabSelection(snapshot, state.selection, activeTabId)
    statesByWorktree.set(snapshot.worktree, {
      selection: nextSelection,
      revision: state.revision + 1,
      shouldPersist: true
    })
    this.persistNow()
    return this.project(snapshot, clientNavigationId)
  }

  captureTabClosureIntent(clientNavigationId: string): ClientSessionTabClosureIntent {
    const clientNavigationIds = new Set([
      ...this.statesByClient.keys(),
      ...this.activationIntents.clientIds(),
      clientNavigationId
    ])
    return new Map(
      [...clientNavigationIds].map((id) => [id, this.activationIntents.current(id)] as const)
    )
  }

  forgetTabs(
    clientNavigationId: string,
    worktreeId: string,
    tabIds: readonly string[],
    closureIntent?: ClientSessionTabClosureIntent
  ): void {
    if (tabIds.length === 0) {
      return
    }
    worktreeId = this.resolveWorktreeId(worktreeId)
    this.tabClosures.forgetPendingActivations(worktreeId, tabIds)
    // Why: tab destruction is global even though each device owns its selection.
    const clientNavigationIds = new Set([
      ...this.statesByClient.keys(),
      ...this.activationIntents.clientIds(),
      ...(closureIntent?.keys() ?? []),
      clientNavigationId
    ])
    let persistedSelectionChanged = false
    for (const id of clientNavigationIds) {
      if (closureIntent === undefined) {
        const currentIntent = this.activationIntents.current(id)
        this.activationIntents.invalidateIfCurrent(id, currentIntent, tabIds)
      } else if (closureIntent.has(id)) {
        this.activationIntents.invalidateIfCurrent(id, closureIntent.get(id), tabIds)
      }
      const statesByWorktree = this.statesByClient.get(id)
      const state = statesByWorktree?.get(worktreeId)
      if (!statesByWorktree || !state) {
        continue
      }
      const closed = this.tabClosures.forgetTabs(id, worktreeId, state.selection, tabIds)
      if (!closed.selectionChanged && !closed.closureChanged) {
        continue
      }
      statesByWorktree.set(worktreeId, {
        selection: closed.selection,
        revision: state.revision + 1,
        shouldPersist: state.shouldPersist
      })
      persistedSelectionChanged ||= state.shouldPersist && closed.selectionChanged
    }
    if (persistedSelectionChanged) {
      this.persistNow()
    }
  }

  isTabForgotten(clientNavigationId: string, worktreeId: string, tabId: string): boolean {
    worktreeId = this.resolveWorktreeId(worktreeId)
    return this.tabClosures.isForgotten(clientNavigationId, worktreeId, tabId)
  }

  beginActivationIntent(clientNavigationId: string): ClientSessionTabActivationIntent {
    return this.activationIntents.begin(clientNavigationId)
  }

  beginTabActivation(
    clientNavigationId: string,
    worktreeId: string,
    tabIds: readonly string[]
  ): void {
    this.tabClosures.beginActivation(clientNavigationId, this.resolveWorktreeId(worktreeId), tabIds)
  }

  finishTabActivation(
    clientNavigationId: string,
    snapshot: RuntimeMobileSessionTabsResult,
    tabIds: readonly string[]
  ): void {
    const worktreeId = this.resolveWorktreeId(snapshot.worktree)
    this.tabClosures.finishActivation(
      clientNavigationId,
      worktreeId === snapshot.worktree ? snapshot : { ...snapshot, worktree: worktreeId },
      tabIds
    )
  }

  forgetClient(clientNavigationId: string): void {
    const statesByWorktree = this.statesByClient.get(clientNavigationId)
    const hadPersistedState = [...(statesByWorktree?.values() ?? [])].some(
      (state) => state.shouldPersist
    )
    this.tabClosures.forgetClient(clientNavigationId)
    this.activationIntents.forgetClient(clientNavigationId)
    if (this.statesByClient.delete(clientNavigationId) && hadPersistedState) {
      this.persistNow()
    }
  }

  migrateWorktree(oldWorktreeId: string, newWorktreeId: string): void {
    const migration = this.worktreeAliases.migrate(oldWorktreeId, newWorktreeId)
    oldWorktreeId = migration.oldWorktreeId
    newWorktreeId = migration.newWorktreeId
    if (oldWorktreeId === newWorktreeId) {
      return
    }
    this.tabClosures.migrateWorktree(oldWorktreeId, newWorktreeId)
    let changed = false
    for (const statesByWorktree of this.statesByClient.values()) {
      const state = statesByWorktree.get(oldWorktreeId)
      if (!state) {
        continue
      }
      statesByWorktree.set(newWorktreeId, state)
      statesByWorktree.delete(oldWorktreeId)
      changed = state.shouldPersist || changed
    }
    if (changed) {
      this.persistNow()
    }
  }

  forgetWorktree(worktreeId: string): void {
    // Why: renderer retires the old snapshot after rename; only remove the exact published identity.
    let changed = false
    for (const [clientNavigationId, statesByWorktree] of this.statesByClient) {
      const state = statesByWorktree.get(worktreeId)
      changed = Boolean(state?.shouldPersist) || changed
      statesByWorktree.delete(worktreeId)
      if (statesByWorktree.size === 0) {
        this.statesByClient.delete(clientNavigationId)
      }
    }
    if (changed) {
      this.persistNow()
    }
  }
}
