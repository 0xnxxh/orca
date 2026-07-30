import { beforeEach, describe, expect, it, vi } from 'vitest'

const storeMocks = vi.hoisted(() => ({
  constructor: vi.fn()
}))

vi.mock('../codex-usage/store', () => ({
  CodexUsageStore: class {
    constructor(store: unknown) {
      storeMocks.constructor(store)
    }
  }
}))

import { CodexUsageStore } from '../codex-usage/store'
import { createCodexUsageStoreStartupCapability } from './codex-usage-store-startup-capability'

describe('Codex usage store startup capability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the constructed live store with the original Store input', async () => {
    const store = { getRepos: vi.fn() }

    const usageStore = await createCodexUsageStoreStartupCapability(store as never)

    expect(storeMocks.constructor).toHaveBeenCalledOnce()
    expect(storeMocks.constructor).toHaveBeenCalledWith(store)
    expect(usageStore).toBeInstanceOf(CodexUsageStore)
  })
})
