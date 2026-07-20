import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  renameRuntimePath: vi.fn()
}))

vi.mock('@/runtime/runtime-file-client', () => ({
  renameRuntimePath: mocks.renameRuntimePath
}))

import { useAppStore } from '@/store'
import { renameOpenTabsPathOnDisk } from './rename-open-editor-tabs-path'
import {
  __clearSelfMoveRegistryForTests,
  isRecentSelfMoveSource,
  isRecentSelfMoveTarget
} from '@/components/editor/editor-self-move-registry'

const CONTEXT = {
  settings: null,
  worktreeId: 'wt-1',
  worktreePath: '/repo',
  connectionId: undefined
}

function openDirtyTab(): void {
  const state = useAppStore.getState()
  state.openFile(
    {
      filePath: '/repo/old.md',
      relativePath: 'old.md',
      worktreeId: 'wt-1',
      runtimeEnvironmentId: null,
      language: 'markdown',
      mode: 'edit'
    },
    { suppressActiveRuntimeFallback: true }
  )
}

describe('renameOpenTabsPathOnDisk', () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true)
    __clearSelfMoveRegistryForTests()
    mocks.renameRuntimePath.mockReset()
  })

  afterEach(() => {
    __clearSelfMoveRegistryForTests()
  })

  it('stamps the move and performs the rename on success', async () => {
    openDirtyTab()
    mocks.renameRuntimePath.mockResolvedValue(undefined)

    await renameOpenTabsPathOnDisk(CONTEXT, '/repo/old.md', '/repo/new.md')

    expect(mocks.renameRuntimePath).toHaveBeenCalledWith(CONTEXT, '/repo/old.md', '/repo/new.md')
    // Stamp survives past the rename so the (possibly delayed) watcher echo is
    // still recognized.
    expect(isRecentSelfMoveSource('/repo/old.md')).toBe(true)
    expect(isRecentSelfMoveTarget('/repo/new.md')).toBe(true)
  })

  it('clears the stamps and rethrows when the rename fails', async () => {
    openDirtyTab()
    const failure = new Error('EACCES')
    mocks.renameRuntimePath.mockRejectedValue(failure)

    await expect(renameOpenTabsPathOnDisk(CONTEXT, '/repo/old.md', '/repo/new.md')).rejects.toThrow(
      'EACCES'
    )

    // A rename that never happened must not keep suppressing genuine events for
    // the untouched paths.
    expect(isRecentSelfMoveSource('/repo/old.md')).toBe(false)
    expect(isRecentSelfMoveTarget('/repo/new.md')).toBe(false)
  })
})
