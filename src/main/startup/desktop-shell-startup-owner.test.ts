import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('desktop-shell startup owner', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('fails closed before installation while optional teardown reads null', async () => {
    const { getDesktopShellStartupCapability, getDesktopShellStartupCapabilityIfInstalled } =
      await import('./desktop-shell-startup-owner')

    expect(getDesktopShellStartupCapabilityIfInstalled()).toBeNull()
    expect(() => getDesktopShellStartupCapability()).toThrow(
      'Desktop-shell capability must be initialized before use'
    )
  })

  it('returns the exact installed capability identity', async () => {
    const {
      getDesktopShellStartupCapability,
      getDesktopShellStartupCapabilityIfInstalled,
      installDesktopShellStartupCapability
    } = await import('./desktop-shell-startup-owner')
    const capability = {
      createMacAppActivationHandler: vi.fn(),
      createSystemTray: vi.fn(),
      destroySystemTray: vi.fn(),
      getNextDefaultOnAppearanceSettingValue: vi.fn(),
      notifyMainWindowBecameVisible: vi.fn(),
      rebuildAppMenu: vi.fn(),
      registerAppMenu: vi.fn(),
      setMacMenuBarIconVisible: vi.fn(),
      setTrayAttention: vi.fn(),
      setUnreadDockBadgeCount: vi.fn(),
      triggerStartupNotificationRegistration: vi.fn(),
      zoomDashboardPopoutIfFocused: vi.fn()
    }

    installDesktopShellStartupCapability(capability as never)

    expect(getDesktopShellStartupCapability()).toBe(capability)
    expect(getDesktopShellStartupCapabilityIfInstalled()).toBe(capability)
  })
})
