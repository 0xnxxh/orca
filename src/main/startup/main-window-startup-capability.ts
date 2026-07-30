import {
  attachMainWindowServices,
  ensureAutoUpdaterConfigured
} from '../window/attach-main-window-services'
import { createMainWindow, loadMainWindow } from '../window/createMainWindow'

export type MainWindowStartupCapability = {
  attachMainWindowServices: typeof attachMainWindowServices
  createMainWindow: typeof createMainWindow
  ensureAutoUpdaterConfigured: typeof ensureAutoUpdaterConfigured
  loadMainWindow: typeof loadMainWindow
}

export function createMainWindowStartupCapability(): MainWindowStartupCapability {
  return {
    attachMainWindowServices,
    createMainWindow,
    ensureAutoUpdaterConfigured,
    loadMainWindow
  }
}
