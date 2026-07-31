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
  removedLeafIds: ReadonlySet<string>
): TerminalPaneLayoutNode | null {
  if (node.type === 'leaf') {
    return removedLeafIds.has(node.leafId) ? null : node
  }

  const first = pruneLeaves(node.first, removedLeafIds)
  const second = pruneLeaves(node.second, removedLeafIds)
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
    retainedLeafId = retainedLeafIdByRemovedLeafId.get(retainedLeafId) ?? retainedLeafId
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
    if (leafId === snapshot.activeLeafId) {
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
  const removedLeafIds = new Set(retainedLeafIdByRemovedLeafId.keys())
  const root = snapshot.root ? pruneLeaves(snapshot.root, removedLeafIds) : null
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
