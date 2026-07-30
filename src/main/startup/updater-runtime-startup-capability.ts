import {
  checkForRemoteServerUpdate,
  checkForUpdatesFromMenu,
  downloadRemoteServerUpdate,
  getRemoteServerUpdaterSnapshot,
  installRemoteServerUpdate,
  resolveUpdateInstallMode
} from '../updater'
import { configureRemoteServerUpdater } from '../runtime/remote-server-updater'

export type UpdaterRuntimeStartupCapability = {
  checkForRemoteServerUpdate: typeof checkForRemoteServerUpdate
  checkForUpdatesFromMenu: typeof checkForUpdatesFromMenu
  configureRemoteServerUpdater: typeof configureRemoteServerUpdater
  downloadRemoteServerUpdate: typeof downloadRemoteServerUpdate
  getRemoteServerUpdaterSnapshot: typeof getRemoteServerUpdaterSnapshot
  installRemoteServerUpdate: typeof installRemoteServerUpdate
  resolveUpdateInstallMode: typeof resolveUpdateInstallMode
}

export function createUpdaterRuntimeStartupCapability(): UpdaterRuntimeStartupCapability {
  return {
    checkForRemoteServerUpdate,
    checkForUpdatesFromMenu,
    configureRemoteServerUpdater,
    downloadRemoteServerUpdate,
    getRemoteServerUpdaterSnapshot,
    installRemoteServerUpdate,
    resolveUpdateInstallMode
  }
}
