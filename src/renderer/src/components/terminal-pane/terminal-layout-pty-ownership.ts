import type { TerminalLayoutSnapshot, TerminalPaneLayoutNode } from '../../../../shared/types'

type TerminalLayoutPtyOwnershipNormalization = {
  snapshot: TerminalLayoutSnapshot
  changed: boolean
}

function collectLeafIds(node: TerminalPaneLayoutNode | null | undefined): string[] {
  if (!node) {
    return []
  }
  if (node.type === 'leaf') {
    return [node.leafId]
  }
  return [...collectLeafIds(node.first), ...collectLeafIds(node.second)]
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
    Object.entries(source).filter(([leafId]) => !retainedLeafIdByRemovedLeafId.has(leafId))
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

function findDuplicatePtyLeafReplacements(snapshot: TerminalLayoutSnapshot): Map<string, string> {
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

  return retainedLeafIdByRemovedLeafId
}

export function normalizeTerminalLayoutPtyOwnership(
  snapshot: TerminalLayoutSnapshot
): TerminalLayoutPtyOwnershipNormalization {
  const retainedLeafIdByRemovedLeafId = findDuplicatePtyLeafReplacements(snapshot)
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
  const activeLeafId = snapshot.activeLeafId
    ? resolveRetainedLeafId(snapshot.activeLeafId, retainedLeafIdByRemovedLeafId)
    : snapshot.activeLeafId
  const ptyIdsByLeafId = coalesceLeafRecord(snapshot.ptyIdsByLeafId, retainedLeafIdByRemovedLeafId)
  const buffersByLeafId = coalesceLeafRecord(
    snapshot.buffersByLeafId,
    retainedLeafIdByRemovedLeafId
  )
  const scrollbackRefsByLeafId = coalesceLeafRecord(
    snapshot.scrollbackRefsByLeafId,
    retainedLeafIdByRemovedLeafId
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
        snapshot.expandedLeafId && removedLeafIds.has(snapshot.expandedLeafId)
          ? null
          : snapshot.expandedLeafId,
      ...(ptyIdsByLeafId ? { ptyIdsByLeafId } : {}),
      ...(buffersByLeafId ? { buffersByLeafId } : {}),
      ...(scrollbackRefsByLeafId ? { scrollbackRefsByLeafId } : {}),
      ...(titlesByLeafId ? { titlesByLeafId } : {})
    },
    changed: true
  }
}
