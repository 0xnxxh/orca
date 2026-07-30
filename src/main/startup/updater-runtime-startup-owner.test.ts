import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('updater-runtime startup owner', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('fails closed before the capability is installed', async () => {
    const { getUpdaterRuntimeStartupCapability } = await import('./updater-runtime-startup-owner')

    expect(() => getUpdaterRuntimeStartupCapability()).toThrow(
      'Updater-runtime capability must be initialized before use'
    )
  })

  it('returns the exact installed capability identity', async () => {
    const { getUpdaterRuntimeStartupCapability, installUpdaterRuntimeStartupCapability } =
      await import('./updater-runtime-startup-owner')
    const capability = {
      checkForRemoteServerUpdate: vi.fn(),
      checkForUpdatesFromMenu: vi.fn(),
      configureRemoteServerUpdater: vi.fn(),
      downloadRemoteServerUpdate: vi.fn(),
      getRemoteServerUpdaterSnapshot: vi.fn(),
      installRemoteServerUpdate: vi.fn(),
      resolveUpdateInstallMode: vi.fn()
    }

    installUpdaterRuntimeStartupCapability(capability as never)

    expect(getUpdaterRuntimeStartupCapability()).toBe(capability)
  })
})
