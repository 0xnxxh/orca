import { describe, expect, it, vi } from 'vitest'

const desktopShellMocks = vi.hoisted(() => ({
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
}))

vi.mock('../dock/unread-badge', () => ({
  setUnreadDockBadgeCount: desktopShellMocks.setUnreadDockBadgeCount
}))
vi.mock('../menu/register-app-menu', () => ({
  getNextDefaultOnAppearanceSettingValue: desktopShellMocks.getNextDefaultOnAppearanceSettingValue,
  rebuildAppMenu: desktopShellMocks.rebuildAppMenu,
  registerAppMenu: desktopShellMocks.registerAppMenu
}))
vi.mock('../ipc/notifications', () => ({
  triggerStartupNotificationRegistration: desktopShellMocks.triggerStartupNotificationRegistration
}))
vi.mock('../tray/system-tray', () => ({
  createSystemTray: desktopShellMocks.createSystemTray,
  destroySystemTray: desktopShellMocks.destroySystemTray,
  setMacMenuBarIconVisible: desktopShellMocks.setMacMenuBarIconVisible,
  setTrayAttention: desktopShellMocks.setTrayAttention
}))
vi.mock('../window/dashboard-popout-window', () => ({
  zoomDashboardPopoutIfFocused: desktopShellMocks.zoomDashboardPopoutIfFocused
}))
vi.mock('../window/macos-app-activation', () => ({
  createMacAppActivationHandler: desktopShellMocks.createMacAppActivationHandler
}))
vi.mock('../window/main-window-visibility', () => ({
  notifyMainWindowBecameVisible: desktopShellMocks.notifyMainWindowBecameVisible
}))

import { createDesktopShellStartupCapability } from './desktop-shell-startup-capability'

describe('desktop-shell startup capability', () => {
  it('returns every original desktop-shell identity', () => {
    expect(createDesktopShellStartupCapability()).toEqual(desktopShellMocks)
  })
})
