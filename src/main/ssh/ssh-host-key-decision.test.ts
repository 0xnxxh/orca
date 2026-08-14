import { describe, expect, it } from 'vitest'
import { decideHostKey, type HostKeyDecisionInput } from './ssh-host-key-decision'

function input(overrides: Partial<HostKeyDecisionInput> = {}): HostKeyDecisionInput {
  return {
    knownHostsOutcome: 'unknown',
    storeOutcome: 'unknown',
    strictHostKeyChecking: 'ask',
    isEphemeralRuntimeTarget: false,
    siteConfigSuppressed: false,
    displayHost: 'build-01',
    ...overrides
  }
}

describe('deciding what to do with a presented host key', () => {
  it('accepts a key either source already holds', () => {
    expect(decideHostKey(input({ knownHostsOutcome: 'match' })).action).toBe('accept')
    expect(decideHostKey(input({ storeOutcome: 'match' })).action).toBe('accept')
  })

  it('remembers a first-contact key', () => {
    expect(decideHostKey(input()).action).toBe('accept-and-remember')
  })

  describe('rejections', () => {
    it.each([
      ['a revoked key', { knownHostsOutcome: 'revoked' as const }, 'revoked'],
      ['a changed key in known_hosts', { knownHostsOutcome: 'mismatch' as const }, 'mismatch'],
      ['a changed key in our own record', { storeOutcome: 'mismatch' as const }, 'mismatch'],
      ['a certificate-authority host', { knownHostsOutcome: 'ca-only' as const }, 'ca-only'],
      [
        'an unfamiliar key type for a host we know',
        { knownHostsOutcome: 'unknown-type-known-host' as const },
        'unknown-type-known-host'
      ],
      // Same downgrade, our own records. Without this the guard covers known_hosts only, so a key
      // we learned on first contact could be sidestepped by presenting another type.
      [
        'an unfamiliar key type for a host only we know',
        { storeOutcome: 'unknown-type-known-host' as const },
        'unknown-type-known-host'
      ]
    ])('rejects %s', (_label, overrides, outcome) => {
      const decision = decideHostKey(input(overrides))
      expect(decision.action).toBe('reject')
      expect(decision.outcome).toBe(outcome)
      expect(decision.reason).toBeTruthy()
    })

    // Revocation is a statement that this key is known-bad, so it outranks a lax setting.
    it('rejects a revoked key even when checking is disabled', () => {
      const decision = decideHostKey(
        input({ knownHostsOutcome: 'revoked', strictHostKeyChecking: 'no' })
      )
      expect(decision.action).toBe('reject')
    })

    it('rejects a changed key even when checking is disabled', () => {
      const decision = decideHostKey(
        input({ knownHostsOutcome: 'mismatch', strictHostKeyChecking: 'off' })
      )
      expect(decision.action).toBe('reject')
    })

    // The reconnect ladder classifies on these substrings; a denial that reads as an auth error
    // gets retried forever against a decision that will never change.
    it.each([
      ['a revoked key', { knownHostsOutcome: 'revoked' as const }],
      ['a changed key', { knownHostsOutcome: 'mismatch' as const }],
      ['an unknown host under strict checking', { strictHostKeyChecking: 'yes' }]
    ])('does not phrase %s as an authentication error', (_label, overrides) => {
      const reason = decideHostKey(input(overrides)).reason ?? ''
      expect(reason.toLowerCase()).not.toContain('authentication failed')
      expect(reason.toLowerCase()).not.toContain('permission denied')
    })

    it('names the remedy that also unblocks ssh when known_hosts disagrees', () => {
      const decision = decideHostKey(input({ knownHostsOutcome: 'mismatch' }))
      expect(decision.disagreeingSource).toBe('known-hosts')
      expect(decision.reason).toContain('ssh-keygen -R build-01')
    })

    it('does not tell the user to edit known_hosts when our own record disagrees', () => {
      const decision = decideHostKey(input({ storeOutcome: 'mismatch' }))
      expect(decision.disagreeingSource).toBe('orca-store')
      expect(decision.reason).not.toContain('ssh-keygen -R')
    })

    it('offers the system-transport escape for certificate-authority hosts', () => {
      const decision = decideHostKey(input({ knownHostsOutcome: 'ca-only' }))
      expect(decision.reason).toContain('ORCA_SSH_FORCE_SYSTEM_TRANSPORT=1')
    })
  })

  describe('StrictHostKeyChecking', () => {
    it.each([['yes'], ['always']])('denies an unknown host under %s', (value) => {
      expect(decideHostKey(input({ strictHostKeyChecking: value })).action).toBe('reject')
    })

    // OpenSSH accepts here but does not write; persisting would turn a deliberately lax setting
    // into a permanent trust record.
    it.each([['no'], ['off']])('accepts without remembering under %s', (value) => {
      expect(decideHostKey(input({ strictHostKeyChecking: value })).action).toBe('accept')
    })

    it('treats an unrecognised value as ask', () => {
      expect(decideHostKey(input({ strictHostKeyChecking: 'banana' })).action).toBe(
        'accept-and-remember'
      )
    })

    it('is case-insensitive', () => {
      expect(decideHostKey(input({ strictHostKeyChecking: 'YES' })).action).toBe('reject')
    })
  })

  describe('carve-outs', () => {
    // A fresh VM presents a new key every launch, so recording one would accumulate a row per
    // launch and eventually turn a stale record into a spurious mismatch.
    it('accepts an ephemeral runtime target without remembering it', () => {
      expect(decideHostKey(input({ isEphemeralRuntimeTarget: true })).action).toBe('accept')
    })

    it('still rejects a changed key for an ephemeral target', () => {
      const decision = decideHostKey(
        input({ isEphemeralRuntimeTarget: true, knownHostsOutcome: 'mismatch' })
      )
      expect(decision.action).toBe('reject')
    })

    // We could not read the system ssh_config, so a site-wide policy may forbid this and we cannot
    // see it. Being laxer than ssh is the one outcome that is never acceptable.
    it('denies an unknown host when the system SSH config could not be read', () => {
      expect(decideHostKey(input({ siteConfigSuppressed: true })).action).toBe('reject')
    })

    it('still accepts a known host when the system SSH config could not be read', () => {
      const decision = decideHostKey(
        input({ siteConfigSuppressed: true, knownHostsOutcome: 'match' })
      )
      expect(decision.action).toBe('accept')
    })
  })

  // Phase 1 ships no dialog at all: startup restore opens many connections at once, ephemeral
  // targets would prompt every launch, and paired-web connects run on someone else's desktop.
  it('never asks for a prompt', () => {
    const cases: Partial<HostKeyDecisionInput>[] = [
      {},
      { knownHostsOutcome: 'match' },
      { knownHostsOutcome: 'mismatch' },
      { knownHostsOutcome: 'revoked' },
      { knownHostsOutcome: 'ca-only' },
      { knownHostsOutcome: 'unknown-type-known-host' },
      { storeOutcome: 'match' },
      { storeOutcome: 'mismatch' },
      { strictHostKeyChecking: 'yes' },
      { strictHostKeyChecking: 'no' },
      { isEphemeralRuntimeTarget: true },
      { siteConfigSuppressed: true }
    ]
    for (const overrides of cases) {
      expect(decideHostKey(input(overrides)).action).not.toBe('prompt')
    }
  })
})
