type ClosingProviderTeardown = {
  keys: string[]
  inFlight: Promise<void> | null
  retry: () => Promise<void>
}

const MAX_RETRYABLE_PROVIDER_TEARDOWNS = 128
const providerTeardownByClosingTabId = new Map<string, ClosingProviderTeardown>()
const retryableProviderTeardowns = new Set<ClosingProviderTeardown>()
let retryAuthorityWasEvicted = false

function failedProviderTeardownProof(): Promise<void> {
  const failure = Promise.reject(new Error('terminal_tab_close_failed'))
  void failure.catch(() => {})
  return failure
}

function clearClosingTabProviderTeardown(entry: ClosingProviderTeardown): void {
  retryableProviderTeardowns.delete(entry)
  for (const tabId of entry.keys) {
    if (providerTeardownByClosingTabId.get(tabId) === entry) {
      providerTeardownByClosingTabId.delete(tabId)
    }
  }
}

function beginClosingTabProviderTeardown(
  entry: ClosingProviderTeardown,
  providerTeardown: Promise<void>
): void {
  retryableProviderTeardowns.delete(entry)
  entry.inFlight = providerTeardown
  for (const tabId of entry.keys) {
    providerTeardownByClosingTabId.set(tabId, entry)
  }
  void providerTeardown.then(
    () => clearClosingTabProviderTeardown(entry),
    () => {
      if (entry.inFlight !== providerTeardown) {
        return
      }
      entry.inFlight = null
      retryableProviderTeardowns.add(entry)
      while (retryableProviderTeardowns.size > MAX_RETRYABLE_PROVIDER_TEARDOWNS) {
        const oldest = retryableProviderTeardowns.values().next().value
        if (!oldest) {
          break
        }
        clearClosingTabProviderTeardown(oldest)
        // Why: after retry authority is discarded, an unknown tab can no longer prove provider absence.
        retryAuthorityWasEvicted = true
      }
    }
  )
}

export function trackTerminalTabProviderTeardown(
  tabIds: readonly string[],
  providerTeardown: Promise<void>,
  retry: () => Promise<void>
): void {
  const entry: ClosingProviderTeardown = {
    keys: [...new Set(tabIds)],
    inFlight: null,
    retry
  }
  beginClosingTabProviderTeardown(entry, providerTeardown)
}

export function getTerminalTabProviderTeardown(tabId: string): Promise<void> | undefined {
  const entry = providerTeardownByClosingTabId.get(tabId)
  if (!entry) {
    return retryAuthorityWasEvicted ? failedProviderTeardownProof() : undefined
  }
  if (entry.inFlight) {
    return entry.inFlight
  }
  let providerTeardown: Promise<void>
  try {
    providerTeardown = entry.retry()
  } catch (error) {
    providerTeardown = Promise.reject(error)
  }
  beginClosingTabProviderTeardown(entry, providerTeardown)
  return providerTeardown
}
