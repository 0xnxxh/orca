import type {
  LegacyPaneKeyAliasEntry,
  TerminalLayoutSnapshot,
  WorkspaceSessionState
} from '../../shared/types'
import type { MigrationUnsupportedPtyEntry } from '../../shared/agent-status-types'
import { isTerminalLeafId, makePaneKey } from '../../shared/stable-pane-id'
import { agentHookServer } from '../agent-hooks/server'
import {
  collectLayoutLeafIdsInOrder,
  firstLayoutLeafId
} from './persistence-terminal-layout-normalization'

export function findWorktreeIdForTab(
  session: WorkspaceSessionState,
  tabId: string
): string | undefined {
  for (const [worktreeId, tabs] of Object.entries(session.tabsByWorktree ?? {})) {
    if (tabs.some((tab) => tab.id === tabId)) {
      return worktreeId
    }
  }
  return undefined
}

export type PaneIdentityMigrationEntries = {
  migrationUnsupportedEntries: MigrationUnsupportedPtyEntry[]
  legacyPaneKeyAliasEntries: LegacyPaneKeyAliasEntry[]
}

export function collectMigrationUnsupportedPtyEntries(args: {
  session: WorkspaceSessionState
  tabId: string
  inputLayout: TerminalLayoutSnapshot
  normalizedLayout: TerminalLayoutSnapshot
  leafIdByInputLeafId: Map<string, string>
}): PaneIdentityMigrationEntries {
  const worktreeId = findWorktreeIdForTab(args.session, args.tabId)
  const tab = worktreeId
    ? args.session.tabsByWorktree?.[worktreeId]?.find((entry) => entry.id === args.tabId)
    : undefined
  const legacyPaneKeyAliasEntries: LegacyPaneKeyAliasEntry[] = []
  const registeredLegacyPaneKeys = new Set<string>()
  const hasLeafPtyBindings = Object.keys(args.inputLayout.ptyIdsByLeafId ?? {}).length > 0
  const fallbackPtyId =
    !hasLeafPtyBindings && typeof tab?.ptyId === 'string' ? tab.ptyId : undefined
  const registerLegacyAlias = (inputLeafId: string, leafId: string, ptyId?: string): boolean => {
    if (!isTerminalLeafId(leafId)) {
      return false
    }
    let paneKey: string
    try {
      paneKey = makePaneKey(args.tabId, leafId)
    } catch {
      return false
    }
    const numeric = /^(?:pane:)?(\d+)$/.exec(inputLeafId)?.[1]
    if (!numeric) {
      return false
    }
    // Why: PaneManager ids are 1-based; a zero-based alias in split layouts makes tab:1 ambiguous and misroutes panes.
    const legacyPaneKey = `${args.tabId}:${numeric}`
    agentHookServer.registerPaneKeyAlias(legacyPaneKey, paneKey, ptyId)
    registeredLegacyPaneKeys.add(legacyPaneKey)
    if (ptyId) {
      legacyPaneKeyAliasEntries.push({
        ptyId,
        legacyPaneKey,
        stablePaneKey: paneKey,
        updatedAt: Date.now()
      })
      return true
    }
    return false
  }
  const inputLeafIds = new Set([
    ...collectLayoutLeafIdsInOrder(args.inputLayout.root),
    ...Object.keys(args.inputLayout.ptyIdsByLeafId ?? {})
  ])
  for (const inputLeafId of inputLeafIds) {
    if (isTerminalLeafId(inputLeafId)) {
      continue
    }
    const leafId = args.leafIdByInputLeafId.get(inputLeafId)
    if (leafId) {
      registerLegacyAlias(
        inputLeafId,
        leafId,
        args.inputLayout.ptyIdsByLeafId?.[inputLeafId] ?? fallbackPtyId
      )
    }
  }
  if (tab?.ptyId && !hasLeafPtyBindings) {
    const fallbackLeafId =
      args.normalizedLayout.activeLeafId ?? firstLayoutLeafId(args.normalizedLayout.root)
    if (fallbackLeafId && isTerminalLeafId(fallbackLeafId)) {
      const paneKey = makePaneKey(args.tabId, fallbackLeafId)
      for (const legacyPaneKey of [`${args.tabId}:0`, `${args.tabId}:1`]) {
        if (registeredLegacyPaneKeys.has(legacyPaneKey)) {
          continue
        }
        agentHookServer.registerPaneKeyAlias(legacyPaneKey, paneKey, tab.ptyId)
        legacyPaneKeyAliasEntries.push({
          ptyId: tab.ptyId,
          legacyPaneKey,
          stablePaneKey: paneKey,
          updatedAt: Date.now()
        })
      }
    }
  }
  // Why: legacy numeric pane keys are now bridged by aliases, not persisted as restart-required rows.
  return { migrationUnsupportedEntries: [], legacyPaneKeyAliasEntries }
}
