import { describe, expect, it, vi } from 'vitest'

const windowMocks = vi.hoisted(() => ({
  attachMainWindowServices: vi.fn(),
  createMainWindow: vi.fn(),
  ensureAutoUpdaterConfigured: vi.fn(),
  loadMainWindow: vi.fn()
}))

vi.mock('../window/attach-main-window-services', () => ({
  attachMainWindowServices: windowMocks.attachMainWindowServices,
  ensureAutoUpdaterConfigured: windowMocks.ensureAutoUpdaterConfigured
}))

vi.mock('../window/createMainWindow', () => ({
  createMainWindow: windowMocks.createMainWindow,
  loadMainWindow: windowMocks.loadMainWindow
}))

import { createMainWindowStartupCapability } from './main-window-startup-capability'

describe('main-window startup capability', () => {
  it('returns all four original function identities', () => {
    const capability = createMainWindowStartupCapability()

    expect(capability).toEqual({
      attachMainWindowServices: windowMocks.attachMainWindowServices,
      createMainWindow: windowMocks.createMainWindow,
      ensureAutoUpdaterConfigured: windowMocks.ensureAutoUpdaterConfigured,
      loadMainWindow: windowMocks.loadMainWindow
    })
  })
})
