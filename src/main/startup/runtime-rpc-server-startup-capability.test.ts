import { beforeEach, describe, expect, it, vi } from 'vitest'

const serverMocks = vi.hoisted(() => ({
  constructor: vi.fn()
}))

vi.mock('../runtime/runtime-rpc', () => ({
  OrcaRuntimeRpcServer: class {
    constructor(options: unknown) {
      serverMocks.constructor(this, options)
    }
  }
}))

import { OrcaRuntimeRpcServer } from '../runtime/runtime-rpc'
import { createOrcaRuntimeRpcServerStartupCapability } from './runtime-rpc-server-startup-capability'

describe('runtime RPC server startup capability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('constructs and returns the same live server with the original options by identity', () => {
    const options = {
      runtime: { getRuntimeId: vi.fn() },
      userDataPath: 'profile-data',
      enableWebSocket: true,
      wsPort: 6769,
      preferPinnedWsPort: true,
      webClientRoot: 'web-client'
    }

    const server = createOrcaRuntimeRpcServerStartupCapability(options as never)

    expect(serverMocks.constructor).toHaveBeenCalledOnce()
    expect(serverMocks.constructor).toHaveBeenCalledWith(server, options)
    expect(server).toBeInstanceOf(OrcaRuntimeRpcServer)
  })
})
