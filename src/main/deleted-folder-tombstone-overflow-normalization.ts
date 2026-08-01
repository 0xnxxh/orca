import type { DeletedFolderWorkspaceSessionTombstoneOverflowBucket } from '../shared/types'
import {
  decodeDeletedFolderOverflowFilter,
  DELETED_FOLDER_OVERFLOW_BUCKET_MS,
  DELETED_FOLDER_OVERFLOW_FILTER_BYTES,
  MAX_DELETED_FOLDER_OVERFLOW_BUCKETS,
  MAX_DELETED_FOLDER_TOMBSTONE_RETENTION_MS
} from './deleted-folder-session-tombstones'

function mergeOverflowFilter(target: Buffer, encodedSource: string | undefined): void {
  if (!encodedSource) {
    return
  }
  const source = Buffer.from(encodedSource, 'base64')
  if (source.length !== DELETED_FOLDER_OVERFLOW_FILTER_BYTES) {
    return
  }
  for (let index = 0; index < target.length; index += 1) {
    target[index] |= source[index]!
  }
}

export function normalizeDeletedFolderTombstoneOverflowBuckets(
  value: unknown,
  now: number
): {
  buckets: DeletedFolderWorkspaceSessionTombstoneOverflowBucket[]
  changed: boolean
} {
  if (!Array.isArray(value)) {
    return { buckets: [], changed: value !== undefined }
  }
  const bucketsByStart = new Map<
    number,
    {
      bucket: DeletedFolderWorkspaceSessionTombstoneOverflowBucket
      workspaceKeyFilter: Buffer
      tabOwnerFilter: Buffer | null
      connectionIdFilter: Buffer | null
    }
  >()
  let changed = false
  for (const candidate of value) {
    const raw = candidate as Partial<DeletedFolderWorkspaceSessionTombstoneOverflowBucket> | null
    const workspaceKeyFilter = decodeDeletedFolderOverflowFilter(raw?.workspaceKeyBits)
    if (
      !raw ||
      typeof raw.bucketStart !== 'number' ||
      !Number.isFinite(raw.bucketStart) ||
      typeof raw.expiresAt !== 'number' ||
      !Number.isFinite(raw.expiresAt) ||
      raw.expiresAt <= now ||
      !workspaceKeyFilter
    ) {
      changed = true
      continue
    }
    const bucketStart =
      Math.floor(raw.bucketStart / DELETED_FOLDER_OVERFLOW_BUCKET_MS) *
      DELETED_FOLDER_OVERFLOW_BUCKET_MS
    const expiresAt = Math.min(
      raw.expiresAt,
      bucketStart + DELETED_FOLDER_OVERFLOW_BUCKET_MS + MAX_DELETED_FOLDER_TOMBSTONE_RETENTION_MS
    )
    const tabOwnerFilter = raw.tabOwnerBits
      ? decodeDeletedFolderOverflowFilter(raw.tabOwnerBits)
      : null
    const connectionIdFilter = raw.connectionIdBits
      ? decodeDeletedFolderOverflowFilter(raw.connectionIdBits)
      : null
    if (
      bucketStart !== raw.bucketStart ||
      expiresAt !== raw.expiresAt ||
      workspaceKeyFilter.toString('base64') !== raw.workspaceKeyBits ||
      Boolean(raw.tabOwnerBits) !== Boolean(tabOwnerFilter) ||
      Boolean(raw.connectionIdBits) !== Boolean(connectionIdFilter) ||
      typeof raw.evidenceTruncated !== 'boolean'
    ) {
      changed = true
    }
    if (bucketStart > now || expiresAt <= now) {
      changed = true
      continue
    }
    const existing = bucketsByStart.get(bucketStart)
    if (existing) {
      mergeOverflowFilter(existing.workspaceKeyFilter, workspaceKeyFilter.toString('base64'))
      if (tabOwnerFilter) {
        existing.tabOwnerFilter ??= Buffer.alloc(DELETED_FOLDER_OVERFLOW_FILTER_BYTES)
        mergeOverflowFilter(existing.tabOwnerFilter, raw.tabOwnerBits)
      }
      if (connectionIdFilter) {
        existing.connectionIdFilter ??= Buffer.alloc(DELETED_FOLDER_OVERFLOW_FILTER_BYTES)
        mergeOverflowFilter(existing.connectionIdFilter, raw.connectionIdBits)
      }
      existing.bucket.expiresAt = Math.max(existing.bucket.expiresAt, expiresAt)
      existing.bucket.evidenceTruncated ||= raw.evidenceTruncated === true
      changed = true
      continue
    }
    bucketsByStart.set(bucketStart, {
      bucket: {
        bucketStart,
        expiresAt,
        workspaceKeyBits: workspaceKeyFilter.toString('base64'),
        ...(tabOwnerFilter ? { tabOwnerBits: tabOwnerFilter.toString('base64') } : {}),
        ...(connectionIdFilter ? { connectionIdBits: connectionIdFilter.toString('base64') } : {}),
        evidenceTruncated: raw.evidenceTruncated === true
      },
      workspaceKeyFilter,
      tabOwnerFilter,
      connectionIdFilter
    })
  }
  const retained = [...bucketsByStart.values()]
    .sort((left, right) => left.bucket.bucketStart - right.bucket.bucketStart)
    .slice(-MAX_DELETED_FOLDER_OVERFLOW_BUCKETS)
    .map(({ bucket, workspaceKeyFilter, tabOwnerFilter, connectionIdFilter }) => ({
      ...bucket,
      workspaceKeyBits: workspaceKeyFilter.toString('base64'),
      ...(tabOwnerFilter ? { tabOwnerBits: tabOwnerFilter.toString('base64') } : {}),
      ...(connectionIdFilter ? { connectionIdBits: connectionIdFilter.toString('base64') } : {})
    }))
  return { buckets: retained, changed: changed || retained.length !== value.length }
}
