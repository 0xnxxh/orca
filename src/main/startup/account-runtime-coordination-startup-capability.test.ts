import { describe, expect, it, vi } from 'vitest'

const accountRuntimeMocks = vi.hoisted(() => ({
  attachClaudeLivePtyPersistence: vi.fn(),
  createAccountRuntimeTargetSettingsSync: vi.fn(),
  getInitialClaudeRateLimitTarget: vi.fn(),
  getInitialCodexRateLimitTarget: vi.fn(),
  normalizeClaudeRuntimeSelection: vi.fn(),
  onLiveClaudePtysDrained: vi.fn(),
  readMiniMaxSessionCookie: vi.fn(),
  seedLiveClaudePtysFromPersistence: vi.fn()
}))

vi.mock('../claude-accounts/live-pty-gate', () => ({
  attachClaudeLivePtyPersistence: accountRuntimeMocks.attachClaudeLivePtyPersistence,
  onLiveClaudePtysDrained: accountRuntimeMocks.onLiveClaudePtysDrained,
  seedLiveClaudePtysFromPersistence: accountRuntimeMocks.seedLiveClaudePtysFromPersistence
}))
vi.mock('../claude-accounts/runtime-selection', () => ({
  normalizeClaudeRuntimeSelection: accountRuntimeMocks.normalizeClaudeRuntimeSelection
}))
vi.mock('../minimax/minimax-cookie-store', () => ({
  readMiniMaxSessionCookie: accountRuntimeMocks.readMiniMaxSessionCookie
}))
vi.mock('../rate-limits/account-runtime-target-sync', () => ({
  createAccountRuntimeTargetSettingsSync: accountRuntimeMocks.createAccountRuntimeTargetSettingsSync
}))
vi.mock('../rate-limits/claude-rate-limit-target', () => ({
  getInitialClaudeRateLimitTarget: accountRuntimeMocks.getInitialClaudeRateLimitTarget
}))
vi.mock('../rate-limits/codex-rate-limit-target', () => ({
  getInitialCodexRateLimitTarget: accountRuntimeMocks.getInitialCodexRateLimitTarget
}))

import { createAccountRuntimeCoordinationStartupCapability } from './account-runtime-coordination-startup-capability'

describe('account-runtime coordination startup capability', () => {
  it('returns every original function identity', () => {
    expect(createAccountRuntimeCoordinationStartupCapability()).toEqual(accountRuntimeMocks)
  })
})
