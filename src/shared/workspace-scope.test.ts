import { describe, expect, it } from 'vitest'
import {
  dualReadFolderWorkspaceKeyedValue,
  folderWorkspaceKey,
  folderWorkspaceSessionKeys,
  migrateFolderWorkspaceKeyedRecord,
  parseWorkspaceKey
} from './workspace-scope'

describe('owner-qualified folder workspace keys', () => {
  it('round-trips owner-qualified keys for same-id multi-host rows', () => {
    const localKey = folderWorkspaceKey('same-id', 'local')
    const sshKey = folderWorkspaceKey('same-id', 'ssh:builder-1')

    expect(localKey).not.toBe(sshKey)
    expect(parseWorkspaceKey(localKey)).toEqual({
      type: 'folder',
      folderWorkspaceId: 'same-id',
      ownerHostId: 'local'
    })
    expect(parseWorkspaceKey(sshKey)).toEqual({
      type: 'folder',
      folderWorkspaceId: 'same-id',
      ownerHostId: 'ssh:builder-1'
    })
  })

  it('keeps legacy bare folder keys parseable', () => {
    expect(parseWorkspaceKey(folderWorkspaceKey('legacy-folder'))).toEqual({
      type: 'folder',
      folderWorkspaceId: 'legacy-folder'
    })
  })

  it('lists both owner-qualified and legacy session keys for cleanup', () => {
    expect(
      folderWorkspaceSessionKeys({ folderWorkspaceId: 'same-id', ownerHostId: 'local' })
    ).toEqual([folderWorkspaceKey('same-id', 'local'), folderWorkspaceKey('same-id')])
  })

  it('dual-reads owner-qualified first, then legacy bare alias', () => {
    const bare = folderWorkspaceKey('folder-workspace-1')
    const qualified = folderWorkspaceKey('folder-workspace-1', 'local')
    const record: Record<string, string> = { [bare]: 'legacy-tabs' }

    expect(
      dualReadFolderWorkspaceKeyedValue((key) => record[key], {
        folderWorkspaceId: 'folder-workspace-1',
        ownerHostId: 'local'
      })
    ).toEqual({ value: 'legacy-tabs', key: bare, viaLegacyAlias: true })

    record[qualified] = 'canonical-tabs'
    expect(
      dualReadFolderWorkspaceKeyedValue((key) => record[key], {
        folderWorkspaceId: 'folder-workspace-1',
        ownerHostId: 'local'
      })
    ).toEqual({ value: 'canonical-tabs', key: qualified, viaLegacyAlias: false })
  })

  it('migrates unambiguous legacy bare folder keys for the default owner', () => {
    const bare = folderWorkspaceKey('folder-workspace-1')
    const qualified = folderWorkspaceKey('folder-workspace-1', 'local')
    const { record, migratedKeys } = migrateFolderWorkspaceKeyedRecord(
      { [bare]: [{ id: 'tab-1' }], [folderWorkspaceKey('ambiguous')]: [{ id: 'tab-2' }] },
      (folderWorkspaceId) => (folderWorkspaceId === 'folder-workspace-1' ? 'local' : null)
    )

    expect(migratedKeys).toEqual([bare])
    expect(record[qualified]).toEqual([{ id: 'tab-1' }])
    expect(record[bare]).toBeUndefined()
    // Multi-owner / unresolved bare keys stay put so callers fail closed.
    expect(record[folderWorkspaceKey('ambiguous')]).toEqual([{ id: 'tab-2' }])
  })

  it('does not overwrite an existing owner-qualified row when migrating bare aliases', () => {
    const bare = folderWorkspaceKey('folder-workspace-1')
    const qualified = folderWorkspaceKey('folder-workspace-1', 'local')
    const { record } = migrateFolderWorkspaceKeyedRecord(
      { [bare]: 'legacy', [qualified]: 'canonical' },
      () => 'local'
    )
    expect(record[qualified]).toBe('canonical')
    expect(record[bare]).toBeUndefined()
  })
})
