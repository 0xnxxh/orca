import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('terminal-runtime startup owner', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('fails closed before installation while permitting early-quit detection', async () => {
    const { getTerminalRuntimeStartupCapability, getTerminalRuntimeStartupCapabilityIfInstalled } =
      await import('./terminal-runtime-startup-owner')

    expect(getTerminalRuntimeStartupCapabilityIfInstalled()).toBeNull()
    expect(() => getTerminalRuntimeStartupCapability()).toThrow(
      'Terminal-runtime capability must be initialized before use'
    )
  })

  it('returns the exact installed capability identity', async () => {
    const {
      getTerminalRuntimeStartupCapability,
      getTerminalRuntimeStartupCapabilityIfInstalled,
      installTerminalRuntimeStartupCapability
    } = await import('./terminal-runtime-startup-owner')
    const capability = {
      clearProviderPtyState: vi.fn(),
      disconnectDaemon: vi.fn(),
      getLocalPtyProvider: vi.fn(),
      getPtyIdForPaneKey: vi.fn(),
      getSshPtyProvider: vi.fn(),
      initDaemonPtyProvider: vi.fn(),
      killAllPty: vi.fn(),
      LocalPtyProvider: vi.fn(),
      registerHeadlessPtyRuntime: vi.fn(),
      registerPaneKeyTeardownListener: vi.fn(),
      shutdownDaemon: vi.fn(),
      startFirstWindowStartupServices: vi.fn()
    }

    installTerminalRuntimeStartupCapability(capability as never)

    expect(getTerminalRuntimeStartupCapability()).toBe(capability)
    expect(getTerminalRuntimeStartupCapabilityIfInstalled()).toBe(capability)
  })
})
