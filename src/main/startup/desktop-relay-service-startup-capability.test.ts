import { beforeEach, describe, expect, it, vi } from 'vitest'

const serviceMocks = vi.hoisted(() => ({
  constructor: vi.fn()
}))

vi.mock('../runtime/relay/desktop-relay-service', () => ({
  DesktopRelayService: class {
    constructor(options: unknown) {
      serviceMocks.constructor(options)
    }
  }
}))

import { DesktopRelayService } from '../runtime/relay/desktop-relay-service'
import { createDesktopRelayServiceStartupCapability } from './desktop-relay-service-startup-capability'

describe('Desktop relay service startup capability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the live service constructed with the original options', async () => {
    const options = { authConfig: { clientId: 'client' } }

    const service = await createDesktopRelayServiceStartupCapability(options as never)

    expect(serviceMocks.constructor).toHaveBeenCalledOnce()
    expect(serviceMocks.constructor).toHaveBeenCalledWith(options)
    expect(service).toBeInstanceOf(DesktopRelayService)
  })
})
