import { describe, expect, it } from 'vitest'
import {
  AI_VAULT_SESSION_LIMIT_RESET_REVISION,
  createAppliedAiVaultSessionLimitReset,
  hasCurrentAiVaultSessionLimitReset,
  resolveAiVaultSessionLimitReset
} from './ai-vault-session-limit-reset'

describe('AI Vault session limit reset', () => {
  it('pulls an upgraded profile back to the performance default and queues the notice', () => {
    for (const sessionLimit of [500, 1000, 'unlimited'] as const) {
      expect(resolveAiVaultSessionLimitReset({ sessionLimit })).toEqual({
        sessionLimit: 250,
        sessionLimitResetRevision: AI_VAULT_SESSION_LIMIT_RESET_REVISION,
        sessionLimitNoticeAcknowledged: false
      })
    }
  })

  it('stays quiet for profiles already at the default', () => {
    expect(resolveAiVaultSessionLimitReset({ sessionLimit: 250 })).toEqual({
      sessionLimit: 250,
      sessionLimitResetRevision: AI_VAULT_SESSION_LIMIT_RESET_REVISION,
      sessionLimitNoticeAcknowledged: true
    })
  })

  it('keeps a deeper history the user re-picked after the reset already ran', () => {
    expect(
      resolveAiVaultSessionLimitReset({
        sessionLimit: 1000,
        sessionLimitResetRevision: AI_VAULT_SESSION_LIMIT_RESET_REVISION,
        sessionLimitNoticeAcknowledged: true
      })
    ).toEqual({
      sessionLimit: 1000,
      sessionLimitResetRevision: AI_VAULT_SESSION_LIMIT_RESET_REVISION,
      sessionLimitNoticeAcknowledged: true
    })
  })

  it('keeps the notice pending across reads until it is acknowledged', () => {
    expect(
      resolveAiVaultSessionLimitReset({
        sessionLimit: 250,
        sessionLimitResetRevision: AI_VAULT_SESSION_LIMIT_RESET_REVISION,
        sessionLimitNoticeAcknowledged: false
      }).sessionLimitNoticeAcknowledged
    ).toBe(false)
  })

  it('treats malformed revisions and depths as never reset', () => {
    expect(hasCurrentAiVaultSessionLimitReset({ sessionLimitResetRevision: 'yes' })).toBe(false)
    expect(hasCurrentAiVaultSessionLimitReset({ sessionLimitResetRevision: 0 })).toBe(false)
    expect(hasCurrentAiVaultSessionLimitReset(null)).toBe(false)
    expect(
      hasCurrentAiVaultSessionLimitReset({
        sessionLimitResetRevision: AI_VAULT_SESSION_LIMIT_RESET_REVISION + 1
      })
    ).toBe(true)
    expect(resolveAiVaultSessionLimitReset({ sessionLimit: 42 })).toEqual({
      sessionLimit: 250,
      sessionLimitResetRevision: AI_VAULT_SESSION_LIMIT_RESET_REVISION,
      sessionLimitNoticeAcknowledged: true
    })
  })

  it('marks fresh profiles as already reset so they see no notice', () => {
    expect(createAppliedAiVaultSessionLimitReset()).toEqual({
      sessionLimit: 250,
      sessionLimitResetRevision: AI_VAULT_SESSION_LIMIT_RESET_REVISION,
      sessionLimitNoticeAcknowledged: true
    })
  })
})
