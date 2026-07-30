import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('shutdown watcher/runtime-metadata startup owner', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('fails closed before installation', async () => {
    const { getShutdownWatcherRuntimeMetadataStartupCapability } =
      await import('./shutdown-watcher-runtime-metadata-startup-owner')

    expect(() => getShutdownWatcherRuntimeMetadataStartupCapability()).toThrow(
      'Shutdown watcher/runtime-metadata capability must be initialized before use'
    )
  })

  it('offers an explicit pre-install no-op path', async () => {
    const { getShutdownWatcherRuntimeMetadataStartupCapabilityIfInstalled } =
      await import('./shutdown-watcher-runtime-metadata-startup-owner')

    expect(getShutdownWatcherRuntimeMetadataStartupCapabilityIfInstalled()).toBeNull()
  })

  it('returns the exact installed capability on both paths', async () => {
    const {
      getShutdownWatcherRuntimeMetadataStartupCapability,
      getShutdownWatcherRuntimeMetadataStartupCapabilityIfInstalled,
      installShutdownWatcherRuntimeMetadataStartupCapability
    } = await import('./shutdown-watcher-runtime-metadata-startup-owner')
    const capability = {
      awaitRuntimeFileWatcherUnsubscribes: vi.fn(),
      clearRuntimeMetadataIfOwned: vi.fn(),
      closeAllWatchers: vi.fn(),
      disposeWorktreeBaseDirectoryWatchers: vi.fn(),
      settleTeardownWithinDeadline: vi.fn()
    }

    installShutdownWatcherRuntimeMetadataStartupCapability(capability as never)

    expect(getShutdownWatcherRuntimeMetadataStartupCapability()).toBe(capability)
    expect(getShutdownWatcherRuntimeMetadataStartupCapabilityIfInstalled()).toBe(capability)
  })
})
