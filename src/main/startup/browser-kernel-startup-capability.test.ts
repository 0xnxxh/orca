import { beforeEach, describe, expect, it, vi } from 'vitest'

const browserMocks = vi.hoisted(() => ({
  browserManager: { marker: 'manager' },
  certificateTrustController: { marker: 'certificate-controller' },
  initializeBrowserSessionsForApp: vi.fn(),
  isAllowedPartition: vi.fn(),
  setWindowDependencies: vi.fn()
}))

vi.mock('../browser/browser-manager', () => ({
  browserManager: browserMocks.browserManager,
  browserCertificateTrustController: browserMocks.certificateTrustController
}))

vi.mock('../browser/browser-session-registry', () => ({
  browserSessionRegistry: {
    isAllowedPartition: browserMocks.isAllowedPartition
  }
}))

vi.mock('../browser/browser-session-startup', () => ({
  initializeBrowserSessionsForApp: browserMocks.initializeBrowserSessionsForApp
}))

vi.mock('../browser/browser-kernel-window-dependencies', () => ({
  setBrowserKernelWindowDependencies: browserMocks.setWindowDependencies
}))

import { createBrowserKernelStartupCapability } from './browser-kernel-startup-capability'

describe('browser kernel startup capability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the exact manager, trust controller, and session initializer identities', () => {
    const capability = createBrowserKernelStartupCapability()

    expect(capability.browserManager).toBe(browserMocks.browserManager)
    expect(capability.browserCertificateTrustController).toBe(
      browserMocks.certificateTrustController
    )
    expect(capability.initializeBrowserSessionsForApp).toBe(
      browserMocks.initializeBrowserSessionsForApp
    )
  })

  it('links window consumers to the same manager and session registry', () => {
    createBrowserKernelStartupCapability()

    expect(browserMocks.setWindowDependencies).toHaveBeenCalledOnce()
    const dependencies = browserMocks.setWindowDependencies.mock.calls[0]?.[0]
    expect(dependencies.browserManager).toBe(browserMocks.browserManager)

    browserMocks.isAllowedPartition.mockReturnValue(true)
    expect(dependencies.isAllowedSessionPartition('persist:profile')).toBe(true)
    expect(browserMocks.isAllowedPartition).toHaveBeenCalledWith('persist:profile')
  })
})
