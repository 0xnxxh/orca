import { describe, expect, it, vi } from 'vitest'
import { attachEmulatorStartupCapability } from './emulator-startup-capability'

describe('emulator startup capability', () => {
  it('attaches one bridge with both desktop emulator backends', () => {
    const setEmulatorBridge = vi.fn()

    const bridge = attachEmulatorStartupCapability({ setEmulatorBridge })

    expect(setEmulatorBridge).toHaveBeenCalledOnce()
    expect(setEmulatorBridge).toHaveBeenCalledWith(bridge)
    expect(bridge.listBackends().map((backend) => backend.kind)).toEqual(['ios', 'android'])
  })
})
