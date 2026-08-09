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
  closedTabIds: ReadonlySet<string>
): { snapshot: RuntimeMobileSessionTabsResult; retainedClosedTabIds: ReadonlySet<string> } {
  const presentTabIds = new Set([
    ...snapshot.tabs.flatMap((tab) => [tab.id, topLevelTabId(tab)]),
    ...(snapshot.tabGroups?.flatMap((group) => group.tabOrder) ?? [])
  ])
  const retainedClosedTabIds = new Set(
    [...closedTabIds].filter((tabId) => presentTabIds.has(tabId))
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
