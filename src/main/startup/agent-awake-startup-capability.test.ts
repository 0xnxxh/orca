import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  powerMonitor: {
    on: vi.fn(),
    off: vi.fn()
  },
  powerSaveBlocker: {
    start: vi.fn(),
    stop: vi.fn(),
    isStarted: vi.fn()
  }
}))

import { AgentAwakeService } from '../agent-awake-service'
import { createAgentAwakeStartupCapability } from './agent-awake-startup-capability'

describe('agent awake startup capability', () => {
  it('returns the live service after initializing runtime statuses as empty', async () => {
    const setStatuses = vi.spyOn(AgentAwakeService.prototype, 'setStatuses')

    const service = await createAgentAwakeStartupCapability()

    expect(service).toBeInstanceOf(AgentAwakeService)
    expect(setStatuses).toHaveBeenCalledOnce()
    expect(setStatuses).toHaveBeenCalledWith([])
    service.dispose()
  })
})
