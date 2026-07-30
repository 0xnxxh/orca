import { describe, expect, it, vi } from 'vitest'

const updaterMocks = vi.hoisted(() => ({
  checkForRemoteServerUpdate: vi.fn(),
  checkForUpdatesFromMenu: vi.fn(),
  configureRemoteServerUpdater: vi.fn(),
  downloadRemoteServerUpdate: vi.fn(),
  getRemoteServerUpdaterSnapshot: vi.fn(),
  installRemoteServerUpdate: vi.fn(),
  resolveUpdateInstallMode: vi.fn()
}))

vi.mock('../updater', () => ({
  checkForRemoteServerUpdate: updaterMocks.checkForRemoteServerUpdate,
  checkForUpdatesFromMenu: updaterMocks.checkForUpdatesFromMenu,
  downloadRemoteServerUpdate: updaterMocks.downloadRemoteServerUpdate,
  getRemoteServerUpdaterSnapshot: updaterMocks.getRemoteServerUpdaterSnapshot,
  installRemoteServerUpdate: updaterMocks.installRemoteServerUpdate,
  resolveUpdateInstallMode: updaterMocks.resolveUpdateInstallMode
}))

vi.mock('../runtime/remote-server-updater', () => ({
  configureRemoteServerUpdater: updaterMocks.configureRemoteServerUpdater
}))

import { createUpdaterRuntimeStartupCapability } from './updater-runtime-startup-capability'

describe('updater-runtime startup capability', () => {
  it('returns every original updater and adapter identity', () => {
    expect(createUpdaterRuntimeStartupCapability()).toEqual(updaterMocks)
  })
})
