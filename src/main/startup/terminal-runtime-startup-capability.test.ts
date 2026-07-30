import { describe, expect, it, vi } from 'vitest'

const terminalMocks = vi.hoisted(() => ({
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
}))

vi.mock('../ipc/pty', () => ({
  clearProviderPtyState: terminalMocks.clearProviderPtyState,
  getLocalPtyProvider: terminalMocks.getLocalPtyProvider,
  getPtyIdForPaneKey: terminalMocks.getPtyIdForPaneKey,
  getSshPtyProvider: terminalMocks.getSshPtyProvider,
  killAllPty: terminalMocks.killAllPty,
  registerHeadlessPtyRuntime: terminalMocks.registerHeadlessPtyRuntime,
  registerPaneKeyTeardownListener: terminalMocks.registerPaneKeyTeardownListener
}))

vi.mock('../daemon/daemon-init', () => ({
  disconnectDaemon: terminalMocks.disconnectDaemon,
  initDaemonPtyProvider: terminalMocks.initDaemonPtyProvider,
  shutdownDaemon: terminalMocks.shutdownDaemon
}))

vi.mock('../providers/local-pty-provider', () => ({
  LocalPtyProvider: terminalMocks.LocalPtyProvider
}))

vi.mock('./first-window-startup-services', () => ({
  startFirstWindowStartupServices: terminalMocks.startFirstWindowStartupServices
}))

import { createTerminalRuntimeStartupCapability } from './terminal-runtime-startup-capability'

describe('terminal-runtime startup capability', () => {
  it('returns every original function and class identity', () => {
    expect(createTerminalRuntimeStartupCapability()).toEqual(terminalMocks)
  })
})
