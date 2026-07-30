import { beforeEach, describe, expect, it, vi } from 'vitest'

const serviceMocks = vi.hoisted(() => ({
  events: [] as string[],
  rateLimitConstructor: vi.fn(),
  codexRuntimeHomeConstructor: vi.fn(),
  codexAccountConstructor: vi.fn(),
  claudeRuntimeAuthConstructor: vi.fn(),
  claudeAccountConstructor: vi.fn()
}))

vi.mock('../rate-limits/service', () => ({
  RateLimitService: class {
    constructor() {
      serviceMocks.events.push('rate-limits')
      serviceMocks.rateLimitConstructor(this)
    }
  }
}))

vi.mock('../codex-accounts/runtime-home-service', () => ({
  CodexRuntimeHomeService: class {
    constructor(store: unknown) {
      serviceMocks.events.push('codex-runtime-home')
      serviceMocks.codexRuntimeHomeConstructor(this, store)
    }
  }
}))

vi.mock('../codex-accounts/service', () => ({
  CodexAccountService: class {
    constructor(store: unknown, rateLimits: unknown, runtimeHome: unknown, lifecycle: unknown) {
      serviceMocks.events.push('codex-account')
      serviceMocks.codexAccountConstructor(this, store, rateLimits, runtimeHome, lifecycle)
    }
  }
}))

vi.mock('../claude-accounts/runtime-auth-service', () => ({
  ClaudeRuntimeAuthService: class {
    constructor(store: unknown) {
      serviceMocks.events.push('claude-runtime-auth')
      serviceMocks.claudeRuntimeAuthConstructor(this, store)
    }
  }
}))

vi.mock('../claude-accounts/service', () => ({
  ClaudeAccountService: class {
    constructor(store: unknown, rateLimits: unknown, runtimeAuth: unknown) {
      serviceMocks.events.push('claude-account')
      serviceMocks.claudeAccountConstructor(this, store, rateLimits, runtimeAuth)
    }
  }
}))

import type { Store } from '../persistence'
import { createAccountServicesStartupCapability } from './account-services-startup-capability'

describe('account services startup capability', () => {
  beforeEach(() => {
    serviceMocks.events.length = 0
    vi.clearAllMocks()
  })

  it('constructs, configures, and schedules in the exact startup order', () => {
    const store = {} as Store
    const lifecycle = { onHostSystemDefaultSelected: vi.fn() }
    const afterCodexAccountCreated = vi.fn(() => {
      serviceMocks.events.push('after-codex-account')
    })
    const configureCodexRuntimeHome = vi.fn((_runtimeHome: unknown) => {
      serviceMocks.events.push('configure-codex-runtime-home')
      return { codexAccountLifecycle: lifecycle, afterCodexAccountCreated }
    })

    const services = createAccountServicesStartupCapability(store, {
      configureCodexRuntimeHome
    })

    expect(serviceMocks.events).toEqual([
      'rate-limits',
      'codex-runtime-home',
      'configure-codex-runtime-home',
      'codex-account',
      'after-codex-account',
      'claude-runtime-auth',
      'claude-account'
    ])
    expect(configureCodexRuntimeHome).toHaveBeenCalledOnce()
    expect(configureCodexRuntimeHome).toHaveBeenCalledWith(services.codexRuntimeHome)
    expect(afterCodexAccountCreated).toHaveBeenCalledOnce()
  })

  it('preserves Store and dependency identity across all five live services', () => {
    const store = {} as Store
    const lifecycle = { onHostSystemDefaultSelected: vi.fn() }

    const services = createAccountServicesStartupCapability(store, {
      configureCodexRuntimeHome: () => ({
        codexAccountLifecycle: lifecycle,
        afterCodexAccountCreated: vi.fn()
      })
    })

    expect(serviceMocks.rateLimitConstructor).toHaveBeenCalledWith(services.rateLimits)
    expect(serviceMocks.codexRuntimeHomeConstructor).toHaveBeenCalledWith(
      services.codexRuntimeHome,
      store
    )
    expect(serviceMocks.codexAccountConstructor).toHaveBeenCalledWith(
      services.codexAccounts,
      store,
      services.rateLimits,
      services.codexRuntimeHome,
      lifecycle
    )
    expect(serviceMocks.claudeRuntimeAuthConstructor).toHaveBeenCalledWith(
      services.claudeRuntimeAuth,
      store
    )
    expect(serviceMocks.claudeAccountConstructor).toHaveBeenCalledWith(
      services.claudeAccounts,
      store,
      services.rateLimits,
      services.claudeRuntimeAuth
    )
  })
})
