import { describe, expect, it, vi } from 'vitest'

const registerCoreHandlers = vi.hoisted(() => vi.fn())

vi.mock('../ipc/register-core-handlers', () => ({ registerCoreHandlers }))

import {
  getCoreIpcRegistryStartupCapability,
  type CoreIpcRegistry
} from './core-ipc-registry-startup-capability'

describe('core IPC registry startup capability', () => {
  it('returns the exact aggregate register function without invoking it', () => {
    const registry = getCoreIpcRegistryStartupCapability()

    expect(registry).toBe(registerCoreHandlers as CoreIpcRegistry)
    expect(registerCoreHandlers).not.toHaveBeenCalled()
  })

  it('reuses the same module-level one-time registry across later windows', () => {
    expect(getCoreIpcRegistryStartupCapability()).toBe(getCoreIpcRegistryStartupCapability())
  })
})
