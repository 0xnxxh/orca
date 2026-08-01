import { createHash } from 'node:crypto'
import type { ExecutionHostId } from '../shared/execution-host'
import type {
  DeletedFolderWorkspaceSessionTombstone,
  DeletedFolderWorkspaceSessionTombstoneOverflowBucket,
  PersistedState,
  WorkspaceKey
} from '../shared/types'

const MAX_TOMBSTONES = 512
export const MAX_DELETED_FOLDER_TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
// Why: daily keyed filters bound churn without turning unrelated remote folder identities into deletions.
export const DELETED_FOLDER_OVERFLOW_BUCKET_MS = 24 * 60 * 60 * 1000
export const MAX_DELETED_FOLDER_OVERFLOW_BUCKETS = 31
export const DELETED_FOLDER_OVERFLOW_FILTER_BYTES = 8 * 1024
const OVERFLOW_BUCKET_MS = DELETED_FOLDER_OVERFLOW_BUCKET_MS
const MAX_OVERFLOW_BUCKETS = MAX_DELETED_FOLDER_OVERFLOW_BUCKETS
const OVERFLOW_FILTER_BYTES = DELETED_FOLDER_OVERFLOW_FILTER_BYTES
const OVERFLOW_FILTER_HASHES = 4
const MAX_HOST_IDS = 32
const MAX_TAB_OWNERS = 256
const overflowFilterCache = new WeakMap<
  DeletedFolderWorkspaceSessionTombstoneOverflowBucket,
  Partial<Record<'workspaceKeyBits' | 'tabOwnerBits' | 'connectionIdBits', Buffer | null>>
>()

export type DeletedFolderTombstoneOverflowEntry = {
  workspaceKey: WorkspaceKey
  tombstone: DeletedFolderWorkspaceSessionTombstone
}

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

export function getDeletedFolderTombstoneEviction(
  tombstones: NonNullable<PersistedState['deletedFolderWorkspaceSessionTombstones']>,
  now: number
): { workspaceKeys: WorkspaceKey[]; overflowEntries: DeletedFolderTombstoneOverflowEntry[] } {
  const entries = Object.entries(tombstones).flatMap(([workspaceKey, tombstone], index) =>
    tombstone ? [{ index, workspaceKey: workspaceKey as WorkspaceKey, tombstone }] : []
  )
  const expired = entries.filter(
    ({ tombstone }) => now - tombstone.deletedAt >= MAX_DELETED_FOLDER_TOMBSTONE_RETENTION_MS
  )
  const expiredKeys = new Set(expired.map(({ workspaceKey }) => workspaceKey))
  const retained = entries.filter(({ workspaceKey }) => !expiredKeys.has(workspaceKey))
  const excess = Math.max(0, retained.length - MAX_TOMBSTONES)
  const capEvictions =
    excess === 0
      ? []
      : retained
          .sort((left, right) =>
            left.tombstone.deletedAt === right.tombstone.deletedAt
              ? left.index - right.index
              : left.tombstone.deletedAt - right.tombstone.deletedAt
          )
          .slice(0, excess)
  return {
    workspaceKeys: [
      ...expired.map(({ workspaceKey }) => workspaceKey),
      ...capEvictions.map(({ workspaceKey }) => workspaceKey)
    ],
    overflowEntries: capEvictions.map(({ workspaceKey, tombstone }) => ({
      workspaceKey,
      tombstone
    }))
  }
}

function getOverflowFilterOffsets(value: string): number[] {
  const digest = createHash('sha256').update(value).digest()
  return Array.from(
    { length: OVERFLOW_FILTER_HASHES },
    (_, index) => digest.readUInt32BE(index * 4) % (OVERFLOW_FILTER_BYTES * 8)
  )
}

function addOverflowFilterValue(filter: Buffer, value: string): void {
  for (const offset of getOverflowFilterOffsets(value)) {
    filter[offset >> 3] |= 1 << (offset & 7)
  }
}

function overflowBucketFilterHasValue(
  bucket: DeletedFolderWorkspaceSessionTombstoneOverflowBucket,
  field: 'workspaceKeyBits' | 'tabOwnerBits' | 'connectionIdBits',
  value: string
): boolean {
  const cached = overflowFilterCache.get(bucket) ?? {}
  let filter = cached[field]
  if (filter === undefined) {
    filter = decodeDeletedFolderOverflowFilter(bucket[field])
    cached[field] = filter
    overflowFilterCache.set(bucket, cached)
  }
  if (!filter) {
    return false
  }
  return getOverflowFilterOffsets(value).every(
    (offset) => (filter[offset >> 3]! & (1 << (offset & 7))) !== 0
  )
}

export function decodeDeletedFolderOverflowFilter(value: unknown): Buffer | null {
  if (typeof value !== 'string') {
    return null
  }
  const decoded = Buffer.from(value, 'base64')
  return decoded.length === OVERFLOW_FILTER_BYTES ? decoded : null
}

export function addDeletedFolderTombstoneOverflowEntries(
  current: DeletedFolderWorkspaceSessionTombstoneOverflowBucket[] | undefined,
  entries: readonly DeletedFolderTombstoneOverflowEntry[],
  now: number
): DeletedFolderWorkspaceSessionTombstoneOverflowBucket[] {
  const buckets = pruneDeletedFolderTombstoneOverflowBuckets(current, now) ?? []
  if (entries.length === 0) {
    return buckets
  }
  const mutableByStart = new Map(
    buckets.map((bucket) => [
      bucket.bucketStart,
      {
        ...bucket,
        workspaceKeyFilter: Buffer.from(bucket.workspaceKeyBits, 'base64'),
        tabOwnerFilter: bucket.tabOwnerBits
          ? Buffer.from(bucket.tabOwnerBits, 'base64')
          : Buffer.alloc(OVERFLOW_FILTER_BYTES),
        connectionIdFilter: bucket.connectionIdBits
          ? Buffer.from(bucket.connectionIdBits, 'base64')
          : Buffer.alloc(OVERFLOW_FILTER_BYTES)
      }
    ])
  )
  for (const { workspaceKey, tombstone } of entries) {
    const bucketStart = Math.floor(tombstone.deletedAt / OVERFLOW_BUCKET_MS) * OVERFLOW_BUCKET_MS
    const bucket = mutableByStart.get(bucketStart) ?? {
      bucketStart,
      expiresAt: tombstone.deletedAt + MAX_DELETED_FOLDER_TOMBSTONE_RETENTION_MS,
      workspaceKeyBits: '',
      evidenceTruncated: false,
      workspaceKeyFilter: Buffer.alloc(OVERFLOW_FILTER_BYTES),
      tabOwnerFilter: Buffer.alloc(OVERFLOW_FILTER_BYTES),
      connectionIdFilter: Buffer.alloc(OVERFLOW_FILTER_BYTES)
    }
    addOverflowFilterValue(bucket.workspaceKeyFilter, workspaceKey)
    if (tombstone.connectionId) {
      addOverflowFilterValue(bucket.connectionIdFilter, tombstone.connectionId)
    }
    for (const [hostId, tabConnectionIds] of Object.entries(tombstone.tabConnectionIdsByHostId)) {
      for (const [tabId, connectionId] of Object.entries(tabConnectionIds ?? {})) {
        addOverflowFilterValue(bucket.tabOwnerFilter, `${hostId}\0${tabId}`)
        if (connectionId) {
          addOverflowFilterValue(bucket.connectionIdFilter, connectionId)
        }
      }
    }
    bucket.expiresAt = Math.max(
      bucket.expiresAt,
      tombstone.deletedAt + MAX_DELETED_FOLDER_TOMBSTONE_RETENTION_MS
    )
    bucket.evidenceTruncated ||= tombstone.evidenceTruncated
    mutableByStart.set(bucketStart, bucket)
  }
  return [...mutableByStart.values()]
    .sort((left, right) => left.bucketStart - right.bucketStart)
    .slice(-MAX_OVERFLOW_BUCKETS)
    .map(({ workspaceKeyFilter, tabOwnerFilter, connectionIdFilter, ...bucket }) => ({
      ...bucket,
      workspaceKeyBits: workspaceKeyFilter.toString('base64'),
      ...(tabOwnerFilter.some((byte) => byte !== 0)
        ? { tabOwnerBits: tabOwnerFilter.toString('base64') }
        : {}),
      ...(connectionIdFilter.some((byte) => byte !== 0)
        ? { connectionIdBits: connectionIdFilter.toString('base64') }
        : {})
    }))
}

export function pruneDeletedFolderTombstoneOverflowBuckets(
  current: DeletedFolderWorkspaceSessionTombstoneOverflowBucket[] | undefined,
  now: number
): DeletedFolderWorkspaceSessionTombstoneOverflowBucket[] | undefined {
  if (!current) {
    return undefined
  }
  const retained = current.filter((bucket) => bucket.expiresAt > now)
  return retained.length === current.length ? current : retained
}

export function hasDeletedFolderWorkspaceKeyOverflowEvidence(
  buckets: readonly DeletedFolderWorkspaceSessionTombstoneOverflowBucket[] | undefined,
  workspaceKey: string,
  now: number
): boolean {
  return (buckets ?? []).some(
    (bucket) =>
      bucket.expiresAt > now &&
      overflowBucketFilterHasValue(bucket, 'workspaceKeyBits', workspaceKey)
  )
}

export function hasDeletedFolderTabOwnerOverflowEvidence(
  buckets: readonly DeletedFolderWorkspaceSessionTombstoneOverflowBucket[] | undefined,
  hostId: ExecutionHostId,
  tabId: string,
  now: number
): boolean {
  return (buckets ?? []).some(
    (bucket) =>
      bucket.expiresAt > now &&
      overflowBucketFilterHasValue(bucket, 'tabOwnerBits', `${hostId}\0${tabId}`)
  )
}

export function hasDeletedFolderConnectionOverflowEvidence(
  buckets: readonly DeletedFolderWorkspaceSessionTombstoneOverflowBucket[] | undefined,
  connectionId: string,
  now: number
): boolean {
  return (buckets ?? []).some(
    (bucket) =>
      bucket.expiresAt > now &&
      overflowBucketFilterHasValue(bucket, 'connectionIdBits', connectionId)
  )
}

export function hasTruncatedDeletedFolderOverflowEvidence(
  buckets: readonly DeletedFolderWorkspaceSessionTombstoneOverflowBucket[] | undefined,
  now: number
): boolean {
  return (buckets ?? []).some((bucket) => bucket.expiresAt > now && bucket.evidenceTruncated)
}
