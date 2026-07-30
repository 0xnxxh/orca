import { beforeEach, describe, expect, it, vi } from 'vitest'

const serviceMocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  registerIpcHandlers: vi.fn(),
  start: vi.fn()
}))

vi.mock('../star-nag/service', () => ({
  StarNagService: class {
    constructor(store: unknown, stats: unknown) {
      serviceMocks.constructor(store, stats)
    }

    start(): void {
      serviceMocks.start()
    }

    registerIpcHandlers(): void {
      serviceMocks.registerIpcHandlers()
    }
  }
}))

import { StarNagService } from '../star-nag/service'
import { createStarNagStartupCapability } from './star-nag-startup-capability'

describe('star nag startup capability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the started live service after registering IPC handlers', async () => {
    const store = {}
    const stats = {}

    const service = await createStarNagStartupCapability(store as never, stats as never)

    expect(serviceMocks.constructor).toHaveBeenCalledOnce()
    expect(serviceMocks.constructor).toHaveBeenCalledWith(store, stats)
    expect(serviceMocks.start).toHaveBeenCalledOnce()
    expect(serviceMocks.registerIpcHandlers).toHaveBeenCalledOnce()
    expect(serviceMocks.start.mock.invocationCallOrder[0]).toBeLessThan(
      serviceMocks.registerIpcHandlers.mock.invocationCallOrder[0]
    )
    expect(service).toBeInstanceOf(StarNagService)
  })
})
