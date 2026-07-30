import { beforeEach, describe, expect, it, vi } from 'vitest'

const collectorMocks = vi.hoisted(() => ({
  constructor: vi.fn()
}))

vi.mock('../stats/collector', () => ({
  StatsCollector: class {
    constructor() {
      collectorMocks.constructor()
    }
  }
}))

import { StatsCollector } from '../stats/collector'
import { createStatsCollectorStartupCapability } from './stats-collector-startup-capability'

describe('StatsCollector startup capability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the constructed live collector', async () => {
    const collector = await createStatsCollectorStartupCapability()

    expect(collectorMocks.constructor).toHaveBeenCalledOnce()
    expect(collector).toBeInstanceOf(StatsCollector)
  })
})
