import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtimeMocks = vi.hoisted(() => ({
  constructor: vi.fn()
}))

vi.mock('../runtime/orca-runtime', () => ({
  OrcaRuntimeService: class {
    constructor(store: unknown, stats: unknown, dependencies: unknown) {
      runtimeMocks.constructor(this, store, stats, dependencies)
    }
  }
}))

import { OrcaRuntimeService } from '../runtime/orca-runtime'
import { createOrcaRuntimeServiceStartupCapability } from './runtime-service-startup-capability'

describe('runtime service startup capability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('constructs and returns the same live instance with every input by identity', () => {
    const store = { getMobileClientTabSelections: vi.fn() }
    const stats = { recordAgentSession: vi.fn() }
    const dependencies = {
      agentSessionClaimSigner: { sign: vi.fn() },
      getLocalProvider: vi.fn(),
      getSshProvider: vi.fn(),
      onPtyStopped: vi.fn(),
      onTerminalAgentStatus: vi.fn(),
      onTerminalSideEffects: vi.fn(),
      getDesktopWindowStatus: vi.fn(),
      getAgentStatusSnapshot: vi.fn(),
      getAgentProviderSessionSnapshot: vi.fn(),
      getAgentProviderSessionRowsForPane: vi.fn(),
      getAdditionalAiVaultCodexHomePaths: vi.fn(),
      prepareAiVaultSessionResume: vi.fn(),
      buildAgentHookPtyEnv: vi.fn(),
      orchestrationEnvironmentTransport: { resolve: vi.fn(), call: vi.fn() }
    }

    const runtime = createOrcaRuntimeServiceStartupCapability(
      store as never,
      stats as never,
      dependencies as never
    )

    expect(runtimeMocks.constructor).toHaveBeenCalledOnce()
    expect(runtimeMocks.constructor).toHaveBeenCalledWith(runtime, store, stats, dependencies)
    expect(runtime).toBeInstanceOf(OrcaRuntimeService)
  })
})
