import type { ExecutionHostId } from '../shared/execution-host'
import type {
  DeletedFolderWorkspaceSessionTombstone,
  PersistedState,
  WorkspaceKey
} from '../shared/types'

const MAX_TOMBSTONES = 512
export const MIN_DELETED_FOLDER_TOMBSTONE_RETENTION_MS = 24 * 60 * 60 * 1000
export const MAX_DELETED_FOLDER_TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const MAX_HOST_IDS = 32
const MAX_TAB_OWNERS = 256

export function boundDeletedFolderTombstoneEvidence(
  tombstone: DeletedFolderWorkspaceSessionTombstone
): DeletedFolderWorkspaceSessionTombstone {
  const tabEntries = Object.entries(tombstone.tabConnectionIdsByHostId).flatMap(([hostId, tabs]) =>
    Object.entries(tabs ?? {}).map(
      ([tabId, connectionId]) => [hostId as ExecutionHostId, tabId, connectionId] as const
    )
  )
  const retainedTabEntries = tabEntries.slice(Math.max(0, tabEntries.length - MAX_TAB_OWNERS))
  const candidateHostIds = [
    ...new Set([...tombstone.hostIds, ...retainedTabEntries.map(([hostId]) => hostId)])
  ]
  const retainedHostIds = candidateHostIds.slice(-MAX_HOST_IDS)
  const retainedHostIdSet = new Set(retainedHostIds)
  const tabConnectionIdsByHostId: DeletedFolderWorkspaceSessionTombstone['tabConnectionIdsByHostId'] =
    {}
  for (const [hostId, tabId, connectionId] of retainedTabEntries) {
    if (!retainedHostIdSet.has(hostId)) {
      continue
    }
    tabConnectionIdsByHostId[hostId] = {
      ...tabConnectionIdsByHostId[hostId],
      [tabId]: connectionId
    }
  }
  return {
    ...tombstone,
    evidenceTruncated:
      tombstone.evidenceTruncated ||
      tabEntries.length > MAX_TAB_OWNERS ||
      candidateHostIds.length > MAX_HOST_IDS,
    hostIds: retainedHostIds,
    tabConnectionIdsByHostId
  }
}

export function getDeletedFolderTombstoneEvictionKeys(
  tombstones: NonNullable<PersistedState['deletedFolderWorkspaceSessionTombstones']>,
  now: number
): WorkspaceKey[] {
  const entries = Object.entries(tombstones).flatMap(([workspaceKey, tombstone], index) =>
    tombstone ? [{ index, workspaceKey: workspaceKey as WorkspaceKey, tombstone }] : []
  )
  const expired = entries.filter(
    ({ tombstone }) => now - tombstone.deletedAt >= MAX_DELETED_FOLDER_TOMBSTONE_RETENTION_MS
  )
  const expiredKeys = new Set(expired.map(({ workspaceKey }) => workspaceKey))
  const retained = entries.filter(({ workspaceKey }) => !expiredKeys.has(workspaceKey))
  const excess = Math.max(0, retained.length - MAX_TOMBSTONES)
  if (excess === 0) {
    return expired.map(({ workspaceKey }) => workspaceKey)
  }
  const softEvictions = retained
    .filter(
      ({ tombstone }) => now - tombstone.deletedAt >= MIN_DELETED_FOLDER_TOMBSTONE_RETENTION_MS
    )
    .sort((left, right) =>
      left.tombstone.deletedAt === right.tombstone.deletedAt
        ? left.index - right.index
        : left.tombstone.deletedAt - right.tombstone.deletedAt
    )
    .slice(0, excess)
  return [
    ...expired.map(({ workspaceKey }) => workspaceKey),
    ...softEvictions.map(({ workspaceKey }) => workspaceKey)
  ]
}
