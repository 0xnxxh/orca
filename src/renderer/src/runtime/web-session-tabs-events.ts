import type { RuntimeMobileSessionTabsResult } from '../../../shared/runtime-types'

export type SessionTabsSnapshotEvent = RuntimeMobileSessionTabsResult & {
  type: 'snapshot' | 'updated'
}

export type SessionTabsStreamEvent =
  | SessionTabsSnapshotEvent
  | { type: 'snapshots'; snapshots: RuntimeMobileSessionTabsResult[] }
  | { type: 'end' }

export type SessionTabsListAllResult = {
  snapshots: RuntimeMobileSessionTabsResult[]
}

export type SessionTabsSnapshotsEvent = SessionTabsListAllResult & {
  type: 'snapshots'
}

export function isRuntimeSessionTabsSnapshot(
  value: unknown
): value is RuntimeMobileSessionTabsResult {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<RuntimeMobileSessionTabsResult>
  return (
    typeof candidate.worktree === 'string' &&
    typeof candidate.publicationEpoch === 'string' &&
    typeof candidate.snapshotVersion === 'number' &&
    Array.isArray(candidate.tabs)
  )
}

export function isSessionTabsListAllResult(value: unknown): value is SessionTabsListAllResult {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    Array.isArray((value as { snapshots?: unknown }).snapshots) &&
    (value as SessionTabsListAllResult).snapshots.every(isRuntimeSessionTabsSnapshot)
  )
}

export function isSessionTabsSnapshotsEvent(value: unknown): value is SessionTabsSnapshotsEvent {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'snapshots' &&
    isSessionTabsListAllResult(value)
  )
}

export function isSessionTabsSnapshotEvent(value: unknown): value is SessionTabsSnapshotEvent {
  return (
    isRuntimeSessionTabsSnapshot(value) &&
    ((value as { type?: unknown }).type === 'snapshot' ||
      (value as { type?: unknown }).type === 'updated')
  )
}
