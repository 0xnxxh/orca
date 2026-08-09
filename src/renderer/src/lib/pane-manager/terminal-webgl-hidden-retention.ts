import type { ManagedPaneInternal } from './pane-manager-types'
import { disposeWebgl } from './pane-webgl-renderer'

// Chromium caps active WebGL contexts per page (~16, #6874); the visible
// worktree typically holds 1-4. Retaining a few hidden contexts keeps recent
// switch-backs on WebGL — no DOM-fallback frames whose divergent cell metrics
// (unfloored width, letter-spacing from a mid-transition measure) flash as
// wider/spaced-out text until reattach completes.
const MAX_RETAINED_HIDDEN_WEBGL_CONTEXTS = 6

type RetainedHiddenEntry = {
  owner: object
  livePanes: () => Iterable<ManagedPaneInternal>
}

// LRU: oldest suspend first.
const retainedEntries: RetainedHiddenEntry[] = []

function liveContextCount(entry: RetainedHiddenEntry): number {
  let count = 0
  for (const pane of entry.livePanes()) {
    if (pane.webglAddon) {
      count += 1
    }
  }
  return count
}

function disposeEntryContexts(entry: RetainedHiddenEntry): void {
  for (const pane of entry.livePanes()) {
    disposeWebgl(pane)
  }
}

function removeEntry(owner: object): void {
  const index = retainedEntries.findIndex((entry) => entry.owner === owner)
  if (index !== -1) {
    retainedEntries.splice(index, 1)
  }
}

/**
 * Try to keep the owner's live WebGL addons across a hide. Returns true when
 * retained — the caller must then skip its dispose pass. Evicts (disposes)
 * least-recently-hidden owners to stay under the context cap.
 */
export function tryRetainHiddenPanesWebgl(
  owner: object,
  livePanes: () => Iterable<ManagedPaneInternal>
): boolean {
  removeEntry(owner)
  const entry: RetainedHiddenEntry = { owner, livePanes }
  const ownCount = liveContextCount(entry)
  // Nothing to retain (GPU off / first-mount hidden), or a single tab too wide
  // for the cap — normal dispose keeps eviction from thrashing every other tab.
  if (ownCount === 0 || ownCount > MAX_RETAINED_HIDDEN_WEBGL_CONTEXTS) {
    return false
  }
  let total = ownCount
  for (const other of retainedEntries) {
    total += liveContextCount(other)
  }
  while (total > MAX_RETAINED_HIDDEN_WEBGL_CONTEXTS && retainedEntries.length > 0) {
    const evicted = retainedEntries.shift()!
    total -= liveContextCount(evicted)
    disposeEntryContexts(evicted)
  }
  retainedEntries.push(entry)
  return true
}

/** Drop retention bookkeeping on reveal/destroy; never disposes live addons. */
export function releaseHiddenWebglRetention(owner: object): void {
  removeEntry(owner)
}

export function retainedHiddenWebglOwnerCountForTest(): number {
  return retainedEntries.length
}

export function resetHiddenWebglRetentionForTest(): void {
  retainedEntries.length = 0
}
