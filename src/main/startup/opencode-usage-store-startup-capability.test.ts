import { beforeEach, describe, expect, it, vi } from 'vitest'

const storeMocks = vi.hoisted(() => ({
  constructor: vi.fn()
}))

vi.mock('../opencode-usage/store', () => ({
  OpenCodeUsageStore: class {
    constructor(store: unknown) {
      storeMocks.constructor(store)
    }
  }
}))

import { OpenCodeUsageStore } from '../opencode-usage/store'
import { createOpenCodeUsageStoreStartupCapability } from './opencode-usage-store-startup-capability'

describe('OpenCode usage store startup capability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the constructed live store with the original Store input', async () => {
    const store = { getRepos: vi.fn() }

    const usageStore = await createOpenCodeUsageStoreStartupCapability(store as never)

    expect(storeMocks.constructor).toHaveBeenCalledOnce()
    expect(storeMocks.constructor).toHaveBeenCalledWith(store)
    expect(usageStore).toBeInstanceOf(OpenCodeUsageStore)
  })
})
