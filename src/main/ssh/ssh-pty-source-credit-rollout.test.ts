import { describe, expect, it } from 'vitest'
import {
  assertSshPtySourceCreditRelayLaunchPolicy,
  isSshPtySourceCreditV1Enabled,
  SshPtySourceCreditRestartRequiredError,
  SSH_PTY_SOURCE_CREDIT_V1_ENV
} from './ssh-pty-source-credit-rollout'

describe('SSH PTY source-credit rollout', () => {
  it('defaults off and requires the exact opt-in value', () => {
    expect(isSshPtySourceCreditV1Enabled({})).toBe(false)
    expect(isSshPtySourceCreditV1Enabled({ [SSH_PTY_SOURCE_CREDIT_V1_ENV]: '0' })).toBe(false)
    expect(isSshPtySourceCreditV1Enabled({ [SSH_PTY_SOURCE_CREDIT_V1_ENV]: 'true' })).toBe(false)
    expect(isSshPtySourceCreditV1Enabled({ [SSH_PTY_SOURCE_CREDIT_V1_ENV]: '1' })).toBe(true)
  })

  it('surfaces a deliberate restart action for a live off-to-on transition', () => {
    expect(new SshPtySourceCreditRestartRequiredError()).toMatchObject({
      name: 'SshPtySourceCreditRestartRequiredError',
      code: 'ssh_pty_source_credit_restart_required',
      message: expect.stringContaining('Reset the relay')
    })
  })

  it('permits stable gate-off legacy and stable gate-on V1 startup selections', () => {
    expect(() => assertSshPtySourceCreditRelayLaunchPolicy(false, 'off')).not.toThrow()
    expect(() => assertSshPtySourceCreditRelayLaunchPolicy(false, 'v1')).not.toThrow()
    expect(() => assertSshPtySourceCreditRelayLaunchPolicy(true, 'v1')).not.toThrow()
  })

  it.each(['off', '', 'unknown'])('fails closed when gate-on reaches policy %j', (policy) => {
    expect(() => assertSshPtySourceCreditRelayLaunchPolicy(true, policy)).toThrow(
      SshPtySourceCreditRestartRequiredError
    )
  })

  it('keeps the process-start selection stable across later environment mutation', () => {
    const startupSelection = isSshPtySourceCreditV1Enabled()
    const previous = process.env[SSH_PTY_SOURCE_CREDIT_V1_ENV]
    process.env[SSH_PTY_SOURCE_CREDIT_V1_ENV] = startupSelection ? '0' : '1'
    try {
      expect(isSshPtySourceCreditV1Enabled()).toBe(startupSelection)
    } finally {
      if (previous === undefined) {
        delete process.env[SSH_PTY_SOURCE_CREDIT_V1_ENV]
      } else {
        process.env[SSH_PTY_SOURCE_CREDIT_V1_ENV] = previous
      }
    }
  })
})
