/**
 * Monotonic activation order for a worktree's terminal tabs.
 *
 * Why: hiddenSince cannot rank tabs that go hidden in the same pass — leaving a
 * worktree hides every tab it owns against one nowMs — and the tie-break of
 * last resort is a random-UUID tab id, so the #8262 keep-warm exemption would
 * be a coin flip. The order the user actually activated tabs in is what tells
 * the policy which tab they land on when they come back.
 */
export type TerminalTabActivationOrder = {
  recordVisibleTabIds(visibleTabIds: ReadonlySet<string>): void
  getActivationSeq(tabId: string): number | undefined
  retainTabIds(liveTabIds: ReadonlySet<string>): void
}

export function createTerminalTabActivationOrder(): TerminalTabActivationOrder {
  const activationSeqByTabId = new Map<string, number>()
  let previouslyVisibleTabIds: ReadonlySet<string> = new Set()
  let nextActivationSeq = 0

  return {
    // Why the hidden->visible edge only: a tab that merely stayed visible was
    // never re-activated, so its rank must not float above tabs activated after
    // it (splits keep one active tab per group visible across many passes).
    recordVisibleTabIds(visibleTabIds) {
      for (const tabId of visibleTabIds) {
        if (!previouslyVisibleTabIds.has(tabId)) {
          activationSeqByTabId.set(tabId, nextActivationSeq)
          nextActivationSeq += 1
        }
      }
      previouslyVisibleTabIds = visibleTabIds
    },
    getActivationSeq(tabId) {
      return activationSeqByTabId.get(tabId)
    },
    retainTabIds(liveTabIds) {
      for (const tabId of Array.from(activationSeqByTabId.keys())) {
        if (!liveTabIds.has(tabId)) {
          activationSeqByTabId.delete(tabId)
        }
      }
    }
  }
}
