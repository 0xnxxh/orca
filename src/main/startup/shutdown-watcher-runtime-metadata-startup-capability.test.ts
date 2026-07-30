import { describe, expect, it, vi } from 'vitest'

const shutdownMocks = vi.hoisted(() => ({
  awaitRuntimeFileWatcherUnsubscribes: vi.fn(),
  clearRuntimeMetadataIfOwned: vi.fn(),
  closeAllWatchers: vi.fn(),
  disposeWorktreeBaseDirectoryWatchers: vi.fn(),
  settleTeardownWithinDeadline: vi.fn()
}))

vi.mock('../ipc/filesystem-watcher', () => ({
  closeAllWatchers: shutdownMocks.closeAllWatchers
}))
vi.mock('../ipc/worktree-base-directory-watcher', () => ({
  disposeWorktreeBaseDirectoryWatchers: shutdownMocks.disposeWorktreeBaseDirectoryWatchers
}))
vi.mock('../quit-teardown-deadline', () => ({
  settleTeardownWithinDeadline: shutdownMocks.settleTeardownWithinDeadline
}))
vi.mock('../runtime/orca-runtime-files', () => ({
  awaitRuntimeFileWatcherUnsubscribes: shutdownMocks.awaitRuntimeFileWatcherUnsubscribes
}))
vi.mock('../runtime/runtime-metadata', () => ({
  clearRuntimeMetadataIfOwned: shutdownMocks.clearRuntimeMetadataIfOwned
}))

import { createShutdownWatcherRuntimeMetadataStartupCapability } from './shutdown-watcher-runtime-metadata-startup-capability'

describe('shutdown watcher/runtime-metadata startup capability', () => {
  it('returns every original function identity', () => {
    expect(createShutdownWatcherRuntimeMetadataStartupCapability()).toEqual(shutdownMocks)
  })
})
