import type { MarkdownDocState, MobileSessionTab } from './mobile-session-route-types'

type ReconciliationOptions = {
  currentTabs: readonly MobileSessionTab[]
  nextTabs: readonly MobileSessionTab[]
  markdownDocs: ReadonlyMap<string, MarkdownDocState>
  activeTabId: string | null
}

type MobileSessionDocumentTab = Extract<MobileSessionTab, { type: 'markdown' | 'file' }>

function documentReadIdentity(tab: MobileSessionDocumentTab): string {
  const contentIdentity =
    tab.type === 'markdown'
      ? tab.documentVersion
      : JSON.stringify([tab.mode ?? null, tab.diffSource ?? null])
  return JSON.stringify([tab.type, tab.filePath, tab.relativePath, contentIdentity])
}

export function reconcileMobileSessionDocuments({
  currentTabs,
  nextTabs,
  markdownDocs,
  activeTabId
}: ReconciliationOptions): {
  tabs: MobileSessionTab[]
  retiredTabIds: ReadonlySet<string>
  changedReadTabIds: ReadonlySet<string>
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
  const nextDocumentTabs = new Map<string, MobileSessionDocumentTab>(
    tabs.flatMap((tab) =>
      tab.type === 'markdown' || tab.type === 'file'
        ? [[`${tab.type}\0${tab.id}`, tab] as const]
        : []
    )
  )
  const changedReadTabIds = new Set(
    currentTabs.flatMap((tab) => {
      if (tab.type !== 'markdown' && tab.type !== 'file') {
        return []
      }
      const next = nextDocumentTabs.get(`${tab.type}\0${tab.id}`)
      if (!next || next.type !== tab.type) {
        return []
      }
      const changed = documentReadIdentity(tab) !== documentReadIdentity(next)
      return changed ? [tab.id] : []
    })
  )
  return { tabs, retiredTabIds, changedReadTabIds }
}

export function omitRetiredMobileSessionDocuments<T>(
  documents: Map<string, T>,
  retiredTabIds: ReadonlySet<string>
): Map<string, T> {
  if (retiredTabIds.size === 0) {
    return documents
  }
  return new Map([...documents].filter(([tabId]) => !retiredTabIds.has(tabId)))
}

export function reconcileChangedMobileMarkdownReads(
  documents: Map<string, MarkdownDocState>,
  changedReadTabIds: ReadonlySet<string>
): Map<string, MarkdownDocState> {
  if (changedReadTabIds.size === 0) {
    return documents
  }
  const next = new Map(documents)
  for (const tabId of changedReadTabIds) {
    const doc = next.get(tabId)
    if (doc?.status === 'ready') {
      next.set(tabId, { ...doc, stale: true })
    } else {
      next.delete(tabId)
    }
  }
  return next
}

export default {
  reconcile: reconcileMobileSessionDocuments,
  omitRetired: omitRetiredMobileSessionDocuments,
  reconcileChanged: reconcileChangedMobileMarkdownReads
}
