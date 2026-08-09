import type {
  RuntimeMobileSessionClientTab,
  RuntimeMobileSessionTabsResult
} from '../../shared/runtime-types'
import type { ClientSessionTabSelection } from './client-session-tab-activation'

function topLevelTabId(tab: RuntimeMobileSessionClientTab): string {
  return tab.type === 'terminal' ? tab.parentTabId : tab.id
}

function findTabByTopLevelId(
  snapshot: RuntimeMobileSessionTabsResult,
  topLevelId: string | null | undefined
): RuntimeMobileSessionClientTab | null {
  if (!topLevelId) {
    return null
  }
  return snapshot.tabs.find((tab) => topLevelTabId(tab) === topLevelId) ?? null
}

export function projectClientSessionTabSelection(
  snapshot: RuntimeMobileSessionTabsResult,
  selection: ClientSessionTabSelection
): { snapshot: RuntimeMobileSessionTabsResult; selection: ClientSessionTabSelection } {
  const selectedGroup = snapshot.tabGroups?.find((group) => group.id === selection.activeGroupId)
  // Why: preserve the client's leaf and group choices before falling back to shared snapshot order.
  const activeTab =
    snapshot.tabs.find((tab) => tab.id === selection.activeTabId) ??
    findTabByTopLevelId(
      snapshot,
      selectedGroup ? selection.activeTabIdByGroupId[selectedGroup.id] : null
    ) ??
    findTabByTopLevelId(snapshot, selectedGroup?.tabOrder[0]) ??
    snapshot.tabs[0] ??
    null
  const activeTopLevelTabId = activeTab ? topLevelTabId(activeTab) : null
  const activeTabIdByGroupId: Record<string, string> = {}
  const tabGroups = snapshot.tabGroups?.map((group) => {
    const selected = selection.activeTabIdByGroupId[group.id]
    const activeTabId =
      (selected && group.tabOrder.includes(selected) ? selected : null) ?? group.tabOrder[0] ?? null
    if (activeTabId) {
      activeTabIdByGroupId[group.id] = activeTabId
    }
    return { ...group, activeTabId }
  })
  const activeGroupId =
    tabGroups?.find((group) =>
      activeTopLevelTabId ? group.tabOrder.includes(activeTopLevelTabId) : false
    )?.id ??
    (selection.activeGroupId && tabGroups?.some((group) => group.id === selection.activeGroupId)
      ? selection.activeGroupId
      : null) ??
    tabGroups?.[0]?.id ??
    null
  const nextSelection: ClientSessionTabSelection = {
    activeTabId: activeTab?.id ?? null,
    activeGroupId,
    activeTabIdByGroupId
  }
  return {
    selection: nextSelection,
    snapshot: {
      ...snapshot,
      activeGroupId,
      activeTabId: activeTab?.id ?? null,
      activeTabType: activeTab?.type ?? null,
      ...(tabGroups ? { tabGroups } : {}),
      tabs: snapshot.tabs.map((tab) => ({ ...tab, isActive: tab.id === activeTab?.id }))
    }
  }
}
