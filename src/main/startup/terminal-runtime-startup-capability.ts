import {
  clearProviderPtyState,
  getLocalPtyProvider,
  getPtyIdForPaneKey,
  getSshPtyProvider,
  killAllPty,
  registerHeadlessPtyRuntime,
  registerPaneKeyTeardownListener
} from '../ipc/pty'
import { disconnectDaemon, initDaemonPtyProvider, shutdownDaemon } from '../daemon/daemon-init'
import { LocalPtyProvider } from '../providers/local-pty-provider'
import { startFirstWindowStartupServices } from './first-window-startup-services'

export type TerminalRuntimeStartupCapability = {
  clearProviderPtyState: typeof clearProviderPtyState
  disconnectDaemon: typeof disconnectDaemon
  getLocalPtyProvider: typeof getLocalPtyProvider
  getPtyIdForPaneKey: typeof getPtyIdForPaneKey
  getSshPtyProvider: typeof getSshPtyProvider
  initDaemonPtyProvider: typeof initDaemonPtyProvider
  killAllPty: typeof killAllPty
  LocalPtyProvider: typeof LocalPtyProvider
  registerHeadlessPtyRuntime: typeof registerHeadlessPtyRuntime
  registerPaneKeyTeardownListener: typeof registerPaneKeyTeardownListener
  shutdownDaemon: typeof shutdownDaemon
  startFirstWindowStartupServices: typeof startFirstWindowStartupServices
}

export function createTerminalRuntimeStartupCapability(): TerminalRuntimeStartupCapability {
  return {
    clearProviderPtyState,
    disconnectDaemon,
    getLocalPtyProvider,
    getPtyIdForPaneKey,
    getSshPtyProvider,
    initDaemonPtyProvider,
    killAllPty,
    LocalPtyProvider,
    registerHeadlessPtyRuntime,
    registerPaneKeyTeardownListener,
    shutdownDaemon,
    startFirstWindowStartupServices
  }
}
