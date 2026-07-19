/**
 * Orchestration lineage for Activity list rows.
 *
 * Mirrors dashboard `agent-row-lineage-model`: resolve parent via
 * `parentPaneKey` / terminal handles, nest children under parents, and keep
 * cycle/unreachable rows visible as roots.
 */

export type ActivityLineageThreadLike = {
  paneKey: string
  paneTitle: string
  terminalHandle?: string | null
  parentPaneKey?: string | null
  parentTerminalHandle?: string | null
  coordinatorHandle?: string | null
}

export type ActivityThreadLineageMeta = {
  depth: number
  parentPaneKey: string | null
  parentTitle: string | null
  childCount: number
  isFirstSibling: boolean
  isLastSibling: boolean
}

export type ActivityThreadLineageItem<T extends ActivityLineageThreadLike> = {
  thread: T
  lineage: ActivityThreadLineageMeta
}

function buildPaneKeyByTerminalHandle<T extends ActivityLineageThreadLike>(
  threads: readonly T[]
): Map<string, string> {
  const map = new Map<string, string>()
  for (const thread of threads) {
    const handle = thread.terminalHandle?.trim()
    if (handle && !map.has(handle)) {
      map.set(handle, thread.paneKey)
    }
  }
  return map
}

export function resolveActivityThreadParentPaneKey<T extends ActivityLineageThreadLike>(
  thread: T,
  byPaneKey: ReadonlyMap<string, T>,
  paneKeyByTerminalHandle: ReadonlyMap<string, string>
): string | null {
  const explicit = thread.parentPaneKey?.trim()
  if (explicit && explicit !== thread.paneKey && byPaneKey.has(explicit)) {
    return explicit
  }

  for (const handle of [thread.parentTerminalHandle, thread.coordinatorHandle]) {
    const trimmed = handle?.trim()
    if (!trimmed) {
      continue
    }
    const parentPaneKey = paneKeyByTerminalHandle.get(trimmed)
    if (parentPaneKey && parentPaneKey !== thread.paneKey && byPaneKey.has(parentPaneKey)) {
      return parentPaneKey
    }
  }

  return null
}

/**
 * Flatten threads into parent-then-children order with lineage metadata for
 * indentation and relationship captions in the list.
 */
export function buildActivityThreadLineageItems<T extends ActivityLineageThreadLike>(
  threads: readonly T[]
): ActivityThreadLineageItem<T>[] {
  if (threads.length === 0) {
    return []
  }

  const byPaneKey = new Map<string, T>()
  for (const thread of threads) {
    if (!byPaneKey.has(thread.paneKey)) {
      byPaneKey.set(thread.paneKey, thread)
    }
  }
  const paneKeyByTerminalHandle = buildPaneKeyByTerminalHandle(threads)
  const childrenByParent = new Map<string, T[]>()
  const childPaneKeys = new Set<string>()

  for (const thread of threads) {
    const parentPaneKey = resolveActivityThreadParentPaneKey(
      thread,
      byPaneKey,
      paneKeyByTerminalHandle
    )
    if (!parentPaneKey) {
      continue
    }
    childPaneKeys.add(thread.paneKey)
    const siblings = childrenByParent.get(parentPaneKey)
    if (siblings) {
      siblings.push(thread)
    } else {
      childrenByParent.set(parentPaneKey, [thread])
    }
  }

  // Preserve caller order among roots / among siblings (group order, recency).
  const orderIndex = new Map(threads.map((thread, index) => [thread.paneKey, index]))
  const sortByCallerOrder = (a: T, b: T): number =>
    (orderIndex.get(a.paneKey) ?? 0) - (orderIndex.get(b.paneKey) ?? 0)

  for (const [parentPaneKey, siblings] of childrenByParent) {
    childrenByParent.set(parentPaneKey, [...siblings].sort(sortByCallerOrder))
  }

  let rootThreads = threads.filter((thread) => !childPaneKeys.has(thread.paneKey))
  if (rootThreads.length === 0) {
    // Why: closed cycles must not hide every participant.
    return threads.map((thread) => ({
      thread,
      lineage: {
        depth: 0,
        parentPaneKey: null,
        parentTitle: null,
        childCount: 0,
        isFirstSibling: true,
        isLastSibling: true
      }
    }))
  }

  const reachable = new Set<string>()
  const visit = (thread: T, ancestors: ReadonlySet<string>): void => {
    if (reachable.has(thread.paneKey) || ancestors.has(thread.paneKey)) {
      return
    }
    reachable.add(thread.paneKey)
    const nextAncestors = new Set(ancestors)
    nextAncestors.add(thread.paneKey)
    for (const child of childrenByParent.get(thread.paneKey) ?? []) {
      visit(child, nextAncestors)
    }
  }
  for (const root of rootThreads) {
    visit(root, new Set())
  }

  for (const thread of threads) {
    if (reachable.has(thread.paneKey)) {
      continue
    }
    // Unreachable (partial cycle): promote to root and detach edges.
    if (!rootThreads.some((root) => root.paneKey === thread.paneKey)) {
      rootThreads = [...rootThreads, thread]
    }
    childPaneKeys.delete(thread.paneKey)
    childrenByParent.delete(thread.paneKey)
    for (const [parentPaneKey, siblings] of childrenByParent) {
      const next = siblings.filter((sibling) => sibling.paneKey !== thread.paneKey)
      if (next.length === 0) {
        childrenByParent.delete(parentPaneKey)
      } else if (next.length !== siblings.length) {
        childrenByParent.set(parentPaneKey, next)
      }
    }
  }

  rootThreads = [...rootThreads].sort(sortByCallerOrder)

  const items: ActivityThreadLineageItem<T>[] = []
  const walk = (thread: T, depth: number, siblingIndex: number, siblingCount: number): void => {
    const children = childrenByParent.get(thread.paneKey) ?? []
    const parentPaneKey =
      depth > 0
        ? resolveActivityThreadParentPaneKey(thread, byPaneKey, paneKeyByTerminalHandle)
        : null
    const parent = parentPaneKey ? byPaneKey.get(parentPaneKey) : undefined
    items.push({
      thread,
      lineage: {
        depth,
        parentPaneKey,
        parentTitle: parent?.paneTitle ?? null,
        childCount: children.length,
        isFirstSibling: siblingIndex === 0,
        isLastSibling: siblingIndex === siblingCount - 1
      }
    })
    children.forEach((child, index) => {
      walk(child, depth + 1, index, children.length)
    })
  }

  rootThreads.forEach((root, index) => {
    walk(root, 0, index, rootThreads.length)
  })

  return items
}
