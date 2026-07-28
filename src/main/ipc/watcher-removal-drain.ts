// Why: worktree deletion has to drain in-flight watcher installs/unsubscribes before Git removes the
// tree, and a wedged native subscribe can leave those promises unsettled forever. Independent per-await
// timeouts would compose (two close passes x two drains), so one removal shares one absolute deadline.

export const WATCHER_REMOVAL_DRAIN_BUDGET_MS = 60_000

export type WatcherRemovalDeadline = {
  remainingMs(): number
}

export function createWatcherRemovalDeadline(
  budgetMs: number = WATCHER_REMOVAL_DRAIN_BUDGET_MS
): WatcherRemovalDeadline {
  const expiresAt = Date.now() + budgetMs
  return {
    remainingMs: () => Math.max(0, expiresAt - Date.now())
  }
}

export type WatcherRemovalDrainOutcome = 'settled' | 'timeout' | 'skipped'

/** Await `promise` until the removal deadline expires. Rejections still propagate so genuine
 *  teardown failures keep failing the delete closed; only an unsettled wait is abandoned. */
export async function drainBeforeWatcherRemoval(
  promise: Promise<unknown> | undefined,
  deadline: WatcherRemovalDeadline,
  label: string
): Promise<WatcherRemovalDrainOutcome> {
  if (!promise) {
    return 'skipped'
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const outcome = await Promise.race([
      promise.then(() => 'settled' as const),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), deadline.remainingMs())
      })
    ])
    if (outcome === 'timeout') {
      console.warn(`[watcher-removal] Timed out waiting for ${label}; continuing removal`)
    }
    return outcome
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}
