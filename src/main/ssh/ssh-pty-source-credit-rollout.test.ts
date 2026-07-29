import { describe, expect, it } from 'vitest'
import {
  assertSshPtySourceCreditRelayLaunchPolicy,
  resolveSshPtySourceCreditV1Selection,
  SshPtySourceCreditRestartRequiredError,
  SSH_PTY_SOURCE_CREDIT_V1_ENV
} from './ssh-pty-source-credit-rollout'

describe('SSH PTY source-credit rollout', () => {
  it('defaults off and permits a per-target opt-in', () => {
    expect(resolveSshPtySourceCreditV1Selection({}, {})).toBe(false)
    expect(resolveSshPtySourceCreditV1Selection({ experimentalPtySourceCreditV1: false }, {})).toBe(
      false
    )
    expect(resolveSshPtySourceCreditV1Selection({ experimentalPtySourceCreditV1: true }, {})).toBe(
      true
    )
  })

  it('lets an explicit environment value override the target selection', () => {
    expect(
      resolveSshPtySourceCreditV1Selection(
        { experimentalPtySourceCreditV1: true },
        { [SSH_PTY_SOURCE_CREDIT_V1_ENV]: '0' }
      )
    ).toBe(false)
    expect(
      resolveSshPtySourceCreditV1Selection(
        { experimentalPtySourceCreditV1: true },
        { [SSH_PTY_SOURCE_CREDIT_V1_ENV]: 'true' }
      )
    ).toBe(false)
    expect(
      resolveSshPtySourceCreditV1Selection(
        { experimentalPtySourceCreditV1: false },
        { [SSH_PTY_SOURCE_CREDIT_V1_ENV]: '1' }
      )
    ).toBe(true)
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
})
