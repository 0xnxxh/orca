import { describe, expect, it, vi } from 'vitest'

const backendMocks = vi.hoisted(() => ({
  constructor: vi.fn()
}))

vi.mock('../browser/offscreen-browser-backend', () => ({
  OffscreenBrowserBackend: class {
    constructor(browserManager: unknown) {
      backendMocks.constructor(browserManager)
    }
  }
}))

import type { BrowserManager } from '../browser/browser-manager'
import { attachOffscreenBrowserStartupCapability } from './offscreen-browser-startup-capability'

describe('offscreen browser startup capability', () => {
  it('constructs with the original manager and attaches the same live backend', () => {
    const browserManager = {} as BrowserManager
    const setOffscreenBrowserBackend = vi.fn()

    const backend = attachOffscreenBrowserStartupCapability(
      { setOffscreenBrowserBackend },
      browserManager
    )

    expect(backendMocks.constructor).toHaveBeenCalledOnce()
    expect(backendMocks.constructor).toHaveBeenCalledWith(browserManager)
    expect(setOffscreenBrowserBackend).toHaveBeenCalledOnce()
    expect(setOffscreenBrowserBackend).toHaveBeenCalledWith(backend)
  })
})
