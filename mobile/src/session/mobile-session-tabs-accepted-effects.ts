import type { SessionTabsStreamSource } from './mobile-session-tabs-stream-health'

type AcceptedSessionTab = {
  id: string
  type: string
  isActive: boolean
  browserPageId?: string | null
  relativePath?: string
  isDirty?: boolean
}

type Options<Tab extends AcceptedSessionTab> = {
  effectiveTabs: readonly Tab[]
  source: SessionTabsStreamSource
  getPendingTabFocusKey: () => string | null
  clearPendingTabFocusKey: (focusKey: string) => void
  activatePendingTab: (tab: Tab) => void
  markActiveMarkdownStale: (tabId: string) => void
}

export function getMobileSessionTabFocusKey(tab: AcceptedSessionTab): string | null {
  if (tab.type === 'browser') {
    return `browser:${tab.browserPageId}`
  }
  return tab.type === 'markdown' ? `markdown:${tab.relativePath}` : null
}

export function runAcceptedMobileSessionTabsEffects<Tab extends AcceptedSessionTab>({
  effectiveTabs,
  source,
  getPendingTabFocusKey,
  clearPendingTabFocusKey,
  activatePendingTab,
  markActiveMarkdownStale
}: Options<Tab>): void {
  const pendingFocusKey = getPendingTabFocusKey()
  if (pendingFocusKey) {
    const pendingTab = effectiveTabs.find(
      (tab) => getMobileSessionTabFocusKey(tab) === pendingFocusKey
    )
    if (pendingTab) {
      clearPendingTabFocusKey(pendingFocusKey)
      activatePendingTab(pendingTab)
    }
  }
  if (source !== 'stream') {
    return
  }
  const activeMarkdown = effectiveTabs.find(
    (tab) => tab.type === 'markdown' && tab.isActive && tab.isDirty
  )
  if (activeMarkdown) {
    markActiveMarkdownStale(activeMarkdown.id)
  }
}
