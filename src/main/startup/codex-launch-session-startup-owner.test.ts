import { describe, expect, it, vi } from 'vitest'
import type { CodexLaunchSessionStartupCapability } from './codex-launch-session-startup-capability'
import {
  getCodexLaunchSessionStartupCapability,
  installCodexLaunchSessionStartupCapability
} from './codex-launch-session-startup-owner'

describe('Codex launch/session startup owner', () => {
  it('fails closed before installation and returns the installed identity', () => {
    expect(() => getCodexLaunchSessionStartupCapability()).toThrow(
      'Codex launch/session capability must be initialized before use'
    )
    const capability = {
      codexHookService: {},
      markCodexProjectTrusted: vi.fn()
    } as unknown as CodexLaunchSessionStartupCapability

    installCodexLaunchSessionStartupCapability(capability)

    expect(getCodexLaunchSessionStartupCapability()).toBe(capability)
  })
})
