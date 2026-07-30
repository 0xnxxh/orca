import { setUnreadDockBadgeCount } from '../dock/unread-badge'
import {
  getNextDefaultOnAppearanceSettingValue,
  rebuildAppMenu,
  registerAppMenu
} from '../menu/register-app-menu'
import { triggerStartupNotificationRegistration } from '../ipc/notifications'
import {
  createSystemTray,
  destroySystemTray,
  setMacMenuBarIconVisible,
  setTrayAttention
} from '../tray/system-tray'
import { zoomDashboardPopoutIfFocused } from '../window/dashboard-popout-window'
import { createMacAppActivationHandler } from '../window/macos-app-activation'
import { notifyMainWindowBecameVisible } from '../window/main-window-visibility'

export type { SystemTrayOptions } from '../tray/system-tray'

export type DesktopShellStartupCapability = {
  createMacAppActivationHandler: typeof createMacAppActivationHandler
  createSystemTray: typeof createSystemTray
  destroySystemTray: typeof destroySystemTray
  getNextDefaultOnAppearanceSettingValue: typeof getNextDefaultOnAppearanceSettingValue
  notifyMainWindowBecameVisible: typeof notifyMainWindowBecameVisible
  rebuildAppMenu: typeof rebuildAppMenu
  registerAppMenu: typeof registerAppMenu
  setMacMenuBarIconVisible: typeof setMacMenuBarIconVisible
  setTrayAttention: typeof setTrayAttention
  setUnreadDockBadgeCount: typeof setUnreadDockBadgeCount
  triggerStartupNotificationRegistration: typeof triggerStartupNotificationRegistration
  zoomDashboardPopoutIfFocused: typeof zoomDashboardPopoutIfFocused
}

export function createDesktopShellStartupCapability(): DesktopShellStartupCapability {
  return {
    createMacAppActivationHandler,
    createSystemTray,
    destroySystemTray,
    getNextDefaultOnAppearanceSettingValue,
    notifyMainWindowBecameVisible,
    rebuildAppMenu,
    registerAppMenu,
    setMacMenuBarIconVisible,
    setTrayAttention,
    setUnreadDockBadgeCount,
    triggerStartupNotificationRegistration,
    zoomDashboardPopoutIfFocused
  }
}
