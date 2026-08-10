import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import type { Store } from '../persistence'

const { persistScanResultMock, readScanSnapshotMock } = vi.hoisted(() => ({
  persistScanResultMock: vi.fn(),
  readScanSnapshotMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn()
  }
}))

vi.mock('../workspace-cleanup-scan-snapshot', () => ({
  persistWorkspaceCleanupScanResult: persistScanResultMock,
  readWorkspaceCleanupScanSnapshot: readScanSnapshotMock
}))

import { registerWorkspaceCleanupHandlers } from './workspace-cleanup'

const NOW = 1_700_000_000_000

function makeEmptyStore(): Store {
  return {
    getRepos: () => [],
    getWorktreeMeta: () => ({}),
    getAllWorktreeMeta: () => ({}),
    getGitHubCache: () => ({ pr: {}, issue: {} })
  } as unknown as Store
}

describe('workspace cleanup snapshot IPC', () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear()
    persistScanResultMock.mockReset().mockResolvedValue(undefined)
    readScanSnapshotMock.mockReset()
  })

  it('persists the completed scan result after replying', async () => {
    registerWorkspaceCleanupHandlers(makeEmptyStore())
    const handler = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === 'workspaceCleanup:scan')?.[1]

    const args = { includeAllWorkspaces: true }
    const result = await handler?.({ sender: { send: vi.fn() } } as never, args)

    expect(persistScanResultMock).toHaveBeenCalledWith(args, result)
  })

  it('serves the cached scan snapshot through getCachedScan', async () => {
    const snapshot = { scannedAt: NOW, candidates: [], errors: [] }
    readScanSnapshotMock.mockResolvedValue(snapshot)
    registerWorkspaceCleanupHandlers(makeEmptyStore())
    const handler = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === 'workspaceCleanup:getCachedScan')?.[1]

    await expect(handler?.({} as never)).resolves.toBe(snapshot)
    expect(vi.mocked(ipcMain.removeHandler)).toHaveBeenCalledWith('workspaceCleanup:getCachedScan')
  })
})
