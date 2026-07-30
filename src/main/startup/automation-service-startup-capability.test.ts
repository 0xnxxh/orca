import { beforeEach, describe, expect, it, vi } from 'vitest'

const serviceMocks = vi.hoisted(() => ({
  constructor: vi.fn()
}))

vi.mock('../automations/service', () => ({
  AutomationService: class {
    constructor(store: unknown, options: unknown) {
      serviceMocks.constructor(store, options)
    }
  }
}))

import { AutomationService } from '../automations/service'
import { createAutomationServiceStartupCapability } from './automation-service-startup-capability'

describe('automation service startup capability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the constructed live service with the original inputs', async () => {
    const store = { listAutomations: vi.fn() }
    const options = {
      claudeUsage: { getUsage: vi.fn() },
      codexUsage: { getUsage: vi.fn() },
      allowRemoteHostScheduling: true,
      headlessDispatcher: vi.fn()
    }

    const service = await createAutomationServiceStartupCapability(store as never, options as never)

    expect(serviceMocks.constructor).toHaveBeenCalledOnce()
    expect(serviceMocks.constructor).toHaveBeenCalledWith(store, options)
    expect(service).toBeInstanceOf(AutomationService)
  })
})
