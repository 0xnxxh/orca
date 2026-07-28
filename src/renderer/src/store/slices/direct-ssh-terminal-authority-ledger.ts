import type { DirectSshAuthority } from '../../../../shared/ssh-types'
import { parseAppSshPtyId } from '../../../../shared/ssh-pty-id'
import type { TerminalTab } from '../../../../shared/types'
import type {
  DirectSshLivePtyBinding,
  DirectSshPaneRetryResult,
  DirectSshTerminalBindingState
} from './direct-ssh-terminal-recovery-types'

export function directSshAuthoritiesEqual(
  left: DirectSshAuthority,
  right: DirectSshAuthority
): boolean {
  return (
    left.targetId === right.targetId &&
    left.providerEpoch === right.providerEpoch &&
    left.connectionGeneration === right.connectionGeneration
  )
}

export function withoutTabIds<T>(
  source: Record<string, T>,
  tabIds: ReadonlySet<string>
): Record<string, T> {
  let next = source
  for (const tabId of tabIds) {
    if (!(tabId in next)) {
      continue
    }
    if (next === source) {
      next = { ...source }
    }
    delete next[tabId]
  }
  return next
}

export function pruneObsoleteAuthorityState(
  state: DirectSshTerminalBindingState,
  authority: DirectSshAuthority
): Pick<
  DirectSshTerminalBindingState,
  | 'directSshPaneRetryByTabId'
  | 'directSshLivePtyBindingByTabId'
  | 'directSshPaneRetryHistoryByTabId'
> {
  const prune = <T extends { authority: DirectSshAuthority }>(
    source: Record<string, T>
  ): Record<string, T> => {
    const obsoleteIds = Object.entries(source)
      .filter(
        ([, value]) =>
          value.authority.targetId === authority.targetId &&
          !directSshAuthoritiesEqual(value.authority, authority)
      )
      .map(([tabId]) => tabId)
    return withoutTabIds(source, new Set(obsoleteIds))
  }
  return {
    directSshPaneRetryByTabId: prune(state.directSshPaneRetryByTabId),
    directSshLivePtyBindingByTabId: prune(state.directSshLivePtyBindingByTabId),
    directSshPaneRetryHistoryByTabId: prune(state.directSshPaneRetryHistoryByTabId)
  }
}

export function liveBindingMatches(
  tab: TerminalTab,
  binding: DirectSshLivePtyBinding | undefined,
  authority: DirectSshAuthority
): boolean {
  return Boolean(
    binding &&
    directSshAuthoritiesEqual(binding.authority, authority) &&
    binding.tabGeneration === (tab.generation ?? 0) &&
    binding.ptyId === tab.ptyId
  )
}

export function settleDirectSshPaneRetryState(
  state: DirectSshTerminalBindingState,
  result: DirectSshPaneRetryResult
): Partial<DirectSshTerminalBindingState> | null {
  const pending = state.directSshPaneRetryByTabId[result.tabId]
  if (
    !pending ||
    pending.attemptId !== result.attemptId ||
    !directSshAuthoritiesEqual(pending.authority, result.authority) ||
    pending.tabGeneration !== result.tabGeneration
  ) {
    return null
  }
  const nextPending = withoutTabIds(state.directSshPaneRetryByTabId, new Set([result.tabId]))
  if (result.status !== 'success') {
    return { directSshPaneRetryByTabId: nextPending }
  }
  const tab = Object.values(state.tabsByWorktree)
    .flat()
    .find((candidate) => candidate.id === result.tabId)
  if (
    !tab ||
    (tab.generation ?? 0) !== result.tabGeneration ||
    tab.ptyId !== result.ptyId ||
    !(state.ptyIdsByTabId[result.tabId] ?? []).includes(result.ptyId)
  ) {
    return null
  }
  return {
    directSshPaneRetryByTabId: nextPending,
    directSshLivePtyBindingByTabId: {
      ...state.directSshLivePtyBindingByTabId,
      [result.tabId]: {
        authority: result.authority,
        tabGeneration: result.tabGeneration,
        ptyId: result.ptyId
      }
    }
  }
}

export function transferDirectSshPaneDetachLedger(
  state: DirectSshTerminalBindingState,
  args: {
    detachedPtyId: string | null
    sourceTabId: string
    targetTabId: string
    isAuthorityCurrent: (authority: DirectSshAuthority) => boolean
  }
): Pick<
  DirectSshTerminalBindingState,
  | 'directSshPaneRetryByTabId'
  | 'directSshLivePtyBindingByTabId'
  | 'directSshPaneRetryHistoryByTabId'
> {
  const tabIds = new Set([args.sourceTabId, args.targetTabId])
  const directSshPaneRetryByTabId = withoutTabIds(state.directSshPaneRetryByTabId, tabIds)
  let directSshLivePtyBindingByTabId = withoutTabIds(state.directSshLivePtyBindingByTabId, tabIds)
  let directSshPaneRetryHistoryByTabId = withoutTabIds(
    state.directSshPaneRetryHistoryByTabId,
    tabIds
  )
  const tabs = Object.values(state.tabsByWorktree).flat()
  const sourceTab = tabs.find((tab) => tab.id === args.sourceTabId)
  const targetTab = tabs.find((tab) => tab.id === args.targetTabId)
  const live = state.directSshLivePtyBindingByTabId[args.sourceTabId]
  const pending = state.directSshPaneRetryByTabId[args.sourceTabId]
  const authority =
    live &&
    sourceTab &&
    liveBindingMatches(sourceTab, live, live.authority) &&
    live.ptyId === args.detachedPtyId
      ? live.authority
      : pending &&
          sourceTab &&
          pending.tabGeneration === (sourceTab.generation ?? 0) &&
          parseAppSshPtyId(args.detachedPtyId ?? '')?.connectionId === pending.authority.targetId
        ? pending.authority
        : null
  if (authority && targetTab && args.detachedPtyId && args.isAuthorityCurrent(authority)) {
    directSshLivePtyBindingByTabId = {
      ...directSshLivePtyBindingByTabId,
      [args.targetTabId]: {
        authority,
        tabGeneration: targetTab.generation ?? 0,
        ptyId: args.detachedPtyId
      }
    }
    const history = state.directSshPaneRetryHistoryByTabId[args.sourceTabId]
    if (history && directSshAuthoritiesEqual(history.authority, authority)) {
      directSshPaneRetryHistoryByTabId = {
        ...directSshPaneRetryHistoryByTabId,
        [args.targetTabId]: history
      }
    }
  }
  return {
    directSshPaneRetryByTabId,
    directSshLivePtyBindingByTabId,
    directSshPaneRetryHistoryByTabId
  }
}
