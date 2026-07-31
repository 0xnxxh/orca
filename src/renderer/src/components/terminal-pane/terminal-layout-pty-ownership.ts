import type { TerminalLayoutSnapshot, TerminalPaneLayoutNode } from '../../../../shared/types'

type TerminalLayoutPtyOwnershipNormalization = {
  snapshot: TerminalLayoutSnapshot
  changed: boolean
}

type DuplicatePtyLeafReplacements = {
  orderedLeafIds: string[]
  retainedLeafIdByRemovedLeafId: Map<string, string>
}

function collectLeafIds(node: TerminalPaneLayoutNode | null | undefined): string[] {
  if (!node) {
    return []
  }
  const leafIds: string[] = []
  const pending = [node]
  while (pending.length > 0) {
    const current = pending.pop()!
    if (current.type === 'leaf') {
      leafIds.push(current.leafId)
      continue
    }
    pending.push(current.second, current.first)
  }
  return leafIds
}

function pruneLeaves(
  node: TerminalPaneLayoutNode,
  retainedLeafIdByRemovedLeafId: ReadonlyMap<string, string>,
  retainedSelfLeafIds: Set<string>
): TerminalPaneLayoutNode | null {
  if (node.type === 'leaf') {
    const retainedLeafId = retainedLeafIdByRemovedLeafId.get(node.leafId)
    if (!retainedLeafId) {
      return node
    }
    if (retainedLeafId === node.leafId && !retainedSelfLeafIds.has(node.leafId)) {
      retainedSelfLeafIds.add(node.leafId)
      return node
    }
    return null
  }

  const first = pruneLeaves(node.first, retainedLeafIdByRemovedLeafId, retainedSelfLeafIds)
  const second = pruneLeaves(node.second, retainedLeafIdByRemovedLeafId, retainedSelfLeafIds)
  if (first && second) {
    return first === node.first && second === node.second ? node : { ...node, first, second }
  }
  return first ?? second
}

function resolveRetainedLeafId(
  leafId: string,
  retainedLeafIdByRemovedLeafId: ReadonlyMap<string, string>
): string {
  let retainedLeafId = leafId
  while (retainedLeafIdByRemovedLeafId.has(retainedLeafId)) {
    const nextLeafId = retainedLeafIdByRemovedLeafId.get(retainedLeafId)
    if (!nextLeafId || nextLeafId === retainedLeafId) {
      return retainedLeafId
    }
    retainedLeafId = nextLeafId
  }
  return retainedLeafId
}

function coalesceLeafRecord(
  source: Record<string, string> | undefined,
  retainedLeafIdByRemovedLeafId: ReadonlyMap<string, string>
): Record<string, string> | undefined {
  if (!source) {
    return undefined
  }
  const retained = Object.fromEntries(
    Object.entries(source).filter(([leafId]) => {
      const retainedLeafId = retainedLeafIdByRemovedLeafId.get(leafId)
      return retainedLeafId === undefined || retainedLeafId === leafId
    })
  )
  for (const [removedLeafId, value] of Object.entries(source)) {
    if (!retainedLeafIdByRemovedLeafId.has(removedLeafId)) {
      continue
    }
    const retainedLeafId = resolveRetainedLeafId(removedLeafId, retainedLeafIdByRemovedLeafId)
    if (!Object.prototype.hasOwnProperty.call(retained, retainedLeafId)) {
      retained[retainedLeafId] = value
    }
  }
  return Object.keys(retained).length > 0 ? retained : undefined
}

function hasLeafRecordValue(source: Record<string, string> | undefined, leafId: string): boolean {
  return Boolean(source && Object.prototype.hasOwnProperty.call(source, leafId))
}

function coalesceScrollbackRecords(
  buffersByLeafId: Record<string, string> | undefined,
  scrollbackRefsByLeafId: Record<string, string> | undefined,
  retainedLeafIdByRemovedLeafId: ReadonlyMap<string, string>,
  orderedLeafIds: readonly string[]
): {
  buffersByLeafId: Record<string, string> | undefined
  scrollbackRefsByLeafId: Record<string, string> | undefined
} {
  const affectedRetainedLeafIds = new Set<string>()
  for (const removedLeafId of retainedLeafIdByRemovedLeafId.keys()) {
    affectedRetainedLeafIds.add(resolveRetainedLeafId(removedLeafId, retainedLeafIdByRemovedLeafId))
  }

  const sourceLeafIdByRetainedLeafId = new Map<string, string>()
  for (const retainedLeafId of affectedRetainedLeafIds) {
    if (
      hasLeafRecordValue(buffersByLeafId, retainedLeafId) ||
      hasLeafRecordValue(scrollbackRefsByLeafId, retainedLeafId)
    ) {
      sourceLeafIdByRetainedLeafId.set(retainedLeafId, retainedLeafId)
    }
  }
  for (const leafId of orderedLeafIds) {
    const retainedLeafId = resolveRetainedLeafId(leafId, retainedLeafIdByRemovedLeafId)
    if (
      !affectedRetainedLeafIds.has(retainedLeafId) ||
      sourceLeafIdByRetainedLeafId.has(retainedLeafId)
    ) {
      continue
    }
    if (
      hasLeafRecordValue(buffersByLeafId, leafId) ||
      hasLeafRecordValue(scrollbackRefsByLeafId, leafId)
    ) {
      sourceLeafIdByRetainedLeafId.set(retainedLeafId, leafId)
    }
  }

  const coalesce = (
    source: Record<string, string> | undefined
  ): Record<string, string> | undefined => {
    if (!source) {
      return undefined
    }
    const retained = Object.fromEntries(
      Object.entries(source).filter(([leafId]) => {
        const retainedLeafId = resolveRetainedLeafId(leafId, retainedLeafIdByRemovedLeafId)
        return !affectedRetainedLeafIds.has(retainedLeafId)
      })
    )
    for (const [retainedLeafId, sourceLeafId] of sourceLeafIdByRetainedLeafId) {
      if (hasLeafRecordValue(source, sourceLeafId)) {
        retained[retainedLeafId] = source[sourceLeafId]!
      }
    }
    return Object.keys(retained).length > 0 ? retained : undefined
  }

  return {
    buffersByLeafId: coalesce(buffersByLeafId),
    scrollbackRefsByLeafId: coalesce(scrollbackRefsByLeafId)
  }
}

function findDuplicatePtyLeafReplacements(
  snapshot: TerminalLayoutSnapshot
): DuplicatePtyLeafReplacements {
  const ptyIdsByLeafId = snapshot.ptyIdsByLeafId ?? {}
  const rootLeafIds = collectLeafIds(snapshot.root)
  const rootLeafIdSet = new Set(rootLeafIds)
  const activeLeafId =
    !snapshot.root || (snapshot.activeLeafId && rootLeafIdSet.has(snapshot.activeLeafId))
      ? snapshot.activeLeafId
      : null
  const orderedLeafIds = [
    ...rootLeafIds,
    ...Object.keys(ptyIdsByLeafId).filter((leafId) => !rootLeafIdSet.has(leafId))
  ]
  const retainedLeafIdByPtyId = new Map<string, string>()
  const retainedLeafIdByRemovedLeafId = new Map<string, string>()

  for (const leafId of orderedLeafIds) {
    const ptyId = ptyIdsByLeafId[leafId]
    if (!ptyId) {
      continue
    }
    const retainedLeafId = retainedLeafIdByPtyId.get(ptyId)
    if (!retainedLeafId) {
      retainedLeafIdByPtyId.set(ptyId, leafId)
      continue
    }
    if (leafId === activeLeafId) {
      retainedLeafIdByRemovedLeafId.set(retainedLeafId, leafId)
      retainedLeafIdByPtyId.set(ptyId, leafId)
      continue
    }
    retainedLeafIdByRemovedLeafId.set(leafId, retainedLeafId)
  }

  return { orderedLeafIds, retainedLeafIdByRemovedLeafId }
}

function resolveOwnedActiveLeafId(
  rootLeafIds: readonly string[],
  activeLeafId: string | null,
  ptyIdsByLeafId: Record<string, string> | undefined
): string | null {
  const hasBinding = (leafId: string): boolean =>
    Boolean(ptyIdsByLeafId && Object.prototype.hasOwnProperty.call(ptyIdsByLeafId, leafId))
  if (rootLeafIds.length === 0) {
    const boundLeafIds = Object.keys(ptyIdsByLeafId ?? {})
    if (activeLeafId && hasBinding(activeLeafId)) {
      return activeLeafId
    }
    return boundLeafIds.length === 1 ? boundLeafIds[0] : null
  }

  if (activeLeafId && rootLeafIds.includes(activeLeafId)) {
    return activeLeafId
  }
  const hasBoundRootLeaf = rootLeafIds.some(hasBinding)
  return hasBoundRootLeaf ? (rootLeafIds.find(hasBinding) ?? null) : (rootLeafIds[0] ?? null)
}

export function normalizeTerminalLayoutPtyOwnership(
  snapshot: TerminalLayoutSnapshot
): TerminalLayoutPtyOwnershipNormalization {
  const { orderedLeafIds, retainedLeafIdByRemovedLeafId } =
    findDuplicatePtyLeafReplacements(snapshot)
  if (retainedLeafIdByRemovedLeafId.size === 0) {
    return { snapshot, changed: false }
  }

  // Why: one live PTY has one renderer surface; retaining both leaves races input, resize, and teardown.
  const removedLeafIds = new Set<string>()
  for (const [removedLeafId, retainedLeafId] of retainedLeafIdByRemovedLeafId) {
    if (removedLeafId !== retainedLeafId) {
      removedLeafIds.add(removedLeafId)
    }
  }
  const root = snapshot.root
    ? pruneLeaves(snapshot.root, retainedLeafIdByRemovedLeafId, new Set())
    : null
  const mappedActiveLeafId = snapshot.activeLeafId
    ? resolveRetainedLeafId(snapshot.activeLeafId, retainedLeafIdByRemovedLeafId)
    : snapshot.activeLeafId
  const ptyIdsByLeafId = coalesceLeafRecord(snapshot.ptyIdsByLeafId, retainedLeafIdByRemovedLeafId)
  const rootLeafIds = collectLeafIds(root)
  const activeLeafId = resolveOwnedActiveLeafId(rootLeafIds, mappedActiveLeafId, ptyIdsByLeafId)
  const { buffersByLeafId, scrollbackRefsByLeafId } = coalesceScrollbackRecords(
    snapshot.buffersByLeafId,
    snapshot.scrollbackRefsByLeafId,
    retainedLeafIdByRemovedLeafId,
    orderedLeafIds
  )
  const titlesByLeafId = coalesceLeafRecord(snapshot.titlesByLeafId, retainedLeafIdByRemovedLeafId)
  const {
    ptyIdsByLeafId: _oldPtyIdsByLeafId,
    buffersByLeafId: _oldBuffersByLeafId,
    scrollbackRefsByLeafId: _oldScrollbackRefsByLeafId,
    titlesByLeafId: _oldTitlesByLeafId,
    ...snapshotWithoutLeafRecords
  } = snapshot

  return {
    snapshot: {
      ...snapshotWithoutLeafRecords,
      root,
      activeLeafId,
      expandedLeafId:
        snapshot.expandedLeafId &&
        !removedLeafIds.has(snapshot.expandedLeafId) &&
        rootLeafIds.includes(snapshot.expandedLeafId)
          ? snapshot.expandedLeafId
          : null,
      ...(ptyIdsByLeafId ? { ptyIdsByLeafId } : {}),
      ...(buffersByLeafId ? { buffersByLeafId } : {}),
      ...(scrollbackRefsByLeafId ? { scrollbackRefsByLeafId } : {}),
      ...(titlesByLeafId ? { titlesByLeafId } : {})
    },
    changed: true
  }
}
