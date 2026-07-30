import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('main-window startup owner', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('fails closed before the capability is installed', async () => {
    const { getMainWindowStartupCapability } = await import('./main-window-startup-owner')

    expect(() => getMainWindowStartupCapability()).toThrow(
      'Main-window capability must be initialized before use'
    )
  })

  it('returns the exact installed capability identity', async () => {
    const { getMainWindowStartupCapability, installMainWindowStartupCapability } =
      await import('./main-window-startup-owner')
    const capability = {
      attachMainWindowServices: vi.fn(),
      createMainWindow: vi.fn(),
      ensureAutoUpdaterConfigured: vi.fn(),
      loadMainWindow: vi.fn()
    }

    installMainWindowStartupCapability(capability as never)

    expect(getMainWindowStartupCapability()).toBe(capability)
  })
})
