import { describe, expect, it } from 'vitest'
import {
  isSshPtySourceCreditV1Enabled,
  SSH_PTY_SOURCE_CREDIT_V1_ENV
} from './ssh-pty-source-credit-rollout'

describe('SSH PTY source-credit rollout', () => {
  it('defaults off and requires the exact opt-in value', () => {
    expect(isSshPtySourceCreditV1Enabled({})).toBe(false)
    expect(isSshPtySourceCreditV1Enabled({ [SSH_PTY_SOURCE_CREDIT_V1_ENV]: '0' })).toBe(false)
    expect(isSshPtySourceCreditV1Enabled({ [SSH_PTY_SOURCE_CREDIT_V1_ENV]: 'true' })).toBe(false)
    expect(isSshPtySourceCreditV1Enabled({ [SSH_PTY_SOURCE_CREDIT_V1_ENV]: '1' })).toBe(true)
  })
})
