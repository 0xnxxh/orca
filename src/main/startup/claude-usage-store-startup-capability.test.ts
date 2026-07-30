import { beforeEach, describe, expect, it, vi } from 'vitest'

const storeMocks = vi.hoisted(() => ({
  constructor: vi.fn()
}))

vi.mock('../claude-usage/store', () => ({
  ClaudeUsageStore: class {
    constructor(store: unknown) {
      storeMocks.constructor(store)
    }
  }
}))

import { ClaudeUsageStore } from '../claude-usage/store'
import { createClaudeUsageStoreStartupCapability } from './claude-usage-store-startup-capability'

describe('Claude usage store startup capability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the constructed live store with the original Store input', async () => {
    const store = { getRepos: vi.fn() }

    const usageStore = await createClaudeUsageStoreStartupCapability(store as never)

    expect(storeMocks.constructor).toHaveBeenCalledOnce()
    expect(storeMocks.constructor).toHaveBeenCalledWith(store)
    expect(usageStore).toBeInstanceOf(ClaudeUsageStore)
  })
})
