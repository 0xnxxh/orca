import { describe, expect, it, vi } from 'vitest'
import type {
  DeletedFolderWorkspaceSessionTombstone,
  PersistedState,
  WorkspaceKey
} from '../shared/types'
import {
  addDeletedFolderTombstoneOverflowEntries,
  getDeletedFolderTombstoneEviction,
  hasDeletedFolderConnectionOverflowEvidence,
  hasDeletedFolderTabOwnerOverflowEvidence,
  hasDeletedFolderWorkspaceKeyOverflowEvidence,
  pruneDeletedFolderTombstoneOverflowBuckets
} from './deleted-folder-session-tombstones'

const NOW = Date.parse('2026-01-15T12:00:00Z')

function tombstone(
  deletedAt = NOW,
  connectionId: string | null = null
): DeletedFolderWorkspaceSessionTombstone {
  return {
    connectionId,
    deletedAt,
    evidenceTruncated: false,
    hostIds: ['local'],
    tabConnectionIdsByHostId: {}
  }
}

describe('deleted folder session tombstones', () => {
  it('does not sort an already-capped tombstone set', () => {
    const tombstones = Object.fromEntries(
      Array.from({ length: 512 }, (_, index) => [`folder:deleted-${index}`, tombstone(NOW - index)])
    ) as NonNullable<PersistedState['deletedFolderWorkspaceSessionTombstones']>
    const sortSpy = vi.spyOn(Array.prototype, 'sort')

    const eviction = getDeletedFolderTombstoneEviction(tombstones, NOW)

    expect(eviction).toEqual({ workspaceKeys: [], overflowEntries: [] })
    expect(sortSpy).not.toHaveBeenCalled()
    sortSpy.mockRestore()
  })

  it('keeps overflow evidence keyed to deleted workspace, tab, and connection identities', () => {
    const workspaceKey = 'folder:deleted' as WorkspaceKey
    const deleted = tombstone(NOW, 'deleted-connection')
    deleted.hostIds = ['runtime:deleted-host']
    deleted.tabConnectionIdsByHostId = {
      'runtime:deleted-host': { 'deleted-tab': 'deleted-connection' }
    }

    const buckets = addDeletedFolderTombstoneOverflowEntries(
      undefined,
      [{ workspaceKey, tombstone: deleted }],
      NOW
    )

    expect(hasDeletedFolderWorkspaceKeyOverflowEvidence(buckets, workspaceKey, NOW)).toBe(true)
    expect(
      hasDeletedFolderTabOwnerOverflowEvidence(buckets, 'runtime:deleted-host', 'deleted-tab', NOW)
    ).toBe(true)
    expect(hasDeletedFolderConnectionOverflowEvidence(buckets, 'deleted-connection', NOW)).toBe(
      true
    )
    expect(hasDeletedFolderWorkspaceKeyOverflowEvidence(buckets, 'folder:unrelated', NOW)).toBe(
      false
    )
    expect(
      hasDeletedFolderTabOwnerOverflowEvidence(
        buckets,
        'runtime:unrelated-host',
        'unrelated-tab',
        NOW
      )
    ).toBe(false)
    expect(hasDeletedFolderConnectionOverflowEvidence(buckets, 'unrelated-connection', NOW)).toBe(
      false
    )
  })

  it('expires overflow buckets without cloning active evidence', () => {
    const buckets = addDeletedFolderTombstoneOverflowEntries(
      undefined,
      [{ workspaceKey: 'folder:deleted' as WorkspaceKey, tombstone: tombstone() }],
      NOW
    )

    expect(pruneDeletedFolderTombstoneOverflowBuckets(buckets, NOW)).toBe(buckets)
    expect(
      pruneDeletedFolderTombstoneOverflowBuckets(buckets, NOW + 30 * 24 * 60 * 60 * 1000)
    ).toEqual([])
  })
})
