import { beforeEach, describe, expect, it, vi } from 'vitest'

const storeMocks = vi.hoisted(() => ({
  constructor: vi.fn()
}))

vi.mock('../persistence', () => ({
  Store: class {
    constructor(options: unknown) {
      storeMocks.constructor(this, options)
    }
  }
}))

import { Store } from '../persistence'
import { createStoreStartupCapability } from './store-startup-capability'

describe('Store startup capability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('constructs and returns the same live Store with the options object by identity', () => {
    const options = { dataFile: 'profile-data.json' }

    const store = createStoreStartupCapability(options)

    expect(storeMocks.constructor).toHaveBeenCalledOnce()
    expect(storeMocks.constructor).toHaveBeenCalledWith(store, options)
    expect(store).toBeInstanceOf(Store)
  })
})
