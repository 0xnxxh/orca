import type { MarkdownDocState, MobileSessionTab } from './mobile-session-route-types'

type ReconciliationOptions = {
  currentTabs: readonly MobileSessionTab[]
  nextTabs: readonly MobileSessionTab[]
  markdownDocs: ReadonlyMap<string, MarkdownDocState>
  activeTabId: string | null
}

export function reconcileMobileSessionDocuments({
  currentTabs,
  nextTabs,
  markdownDocs,
  activeTabId
}: ReconciliationOptions): {
  tabs: MobileSessionTab[]
  retiredTabIds: ReadonlySet<string>
} {
  const presentTabIds = new Set(nextTabs.map((tab) => tab.id))
  const orphanedDraftTabs: MobileSessionTab[] = []
  for (const [tabId, doc] of markdownDocs) {
    if (doc.status !== 'ready' || !doc.isDirty || presentTabIds.has(tabId)) {
      continue
    }
    const draftTab = currentTabs.find(
      (tab): tab is Extract<MobileSessionTab, { type: 'markdown' }> =>
        tab.type === 'markdown' && tab.id === tabId
    )
    if (draftTab) {
      // Why: phone edits remain local until Save, so a vanished host tab must not retire the draft.
      orphanedDraftTabs.push({ ...draftTab, isActive: tabId === activeTabId })
    }
  }
  const tabs = orphanedDraftTabs.length > 0 ? [...orphanedDraftTabs, ...nextTabs] : [...nextTabs]
  const nextDocumentTabKeys = new Set(
    tabs.flatMap((tab) =>
      tab.type === 'markdown' || tab.type === 'file' ? [`${tab.type}\0${tab.id}`] : []
    )
  )
  const retiredTabIds = new Set(
    currentTabs.flatMap((tab) =>
      (tab.type === 'markdown' || tab.type === 'file') &&
      !nextDocumentTabKeys.has(`${tab.type}\0${tab.id}`)
        ? [tab.id]
        : []
    )
  )
  return { tabs, retiredTabIds }
}

export function omitRetiredMobileSessionDocuments<T>(
  documents: ReadonlyMap<string, T>,
  retiredTabIds: ReadonlySet<string>
): Map<string, T> {
  return new Map([...documents].filter(([tabId]) => !retiredTabIds.has(tabId)))
}

export default {
  reconcile: reconcileMobileSessionDocuments,
  omitRetired: omitRetiredMobileSessionDocuments
}
