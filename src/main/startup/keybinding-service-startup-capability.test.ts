import { beforeEach, describe, expect, it, vi } from 'vitest'

const serviceMocks = vi.hoisted(() => ({
  constructor: vi.fn()
}))

vi.mock('../keybindings/keybinding-service', () => ({
  KeybindingService: class {
    constructor(options: unknown) {
      serviceMocks.constructor(options)
    }
  }
}))

import { KeybindingService } from '../keybindings/keybinding-service'
import { createKeybindingServiceStartupCapability } from './keybinding-service-startup-capability'

describe('keybinding service startup capability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the constructed live service with the original options', async () => {
    const options = {
      homePath: '/Users/example',
      platform: 'darwin' as const,
      getLegacyOverrides: vi.fn(),
      legacyTabSwitchSeed: {
        isPending: vi.fn(),
        markSeeded: vi.fn()
      }
    }

    const service = await createKeybindingServiceStartupCapability(options)

    expect(serviceMocks.constructor).toHaveBeenCalledOnce()
    expect(serviceMocks.constructor).toHaveBeenCalledWith(options)
    expect(service).toBeInstanceOf(KeybindingService)
  })
})
