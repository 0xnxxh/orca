import { describe, expect, it } from 'vitest'
import { decideHostKey, type HostKeyDecisionInput } from './ssh-host-key-decision'

function input(overrides: Partial<HostKeyDecisionInput> = {}): HostKeyDecisionInput {
  return {
    knownHostsOutcome: 'unknown',
    storeOutcome: 'unknown',
    strictHostKeyChecking: 'ask',
    isEphemeralRuntimeTarget: false,
    verificationSourcesIncomplete: false,
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

    // Verified live against OpenSSH 10.2p1: an ed25519 key offered where known_hosts holds only
    // ssh-rsa makes ssh print IDENTIFICATION HAS CHANGED and refuse. ssh is blocked too, so the
    // same remedy applies — without it this case diagnosed the problem and offered no way out.
    it('names the remedy for an unfamiliar key type known_hosts disagrees on', () => {
      const decision = decideHostKey(input({ knownHostsOutcome: 'unknown-type-known-host' }))
      expect(decision.disagreeingSource).toBe('known-hosts')
      expect(decision.reason).toContain('ssh-keygen -R build-01')
    })

    // Our own record is not in known_hosts, so ssh-keygen -R would remove nothing.
    it('does not name ssh-keygen for an unfamiliar key type only we know about', () => {
      const decision = decideHostKey(input({ storeOutcome: 'unknown-type-known-host' }))
      expect(decision.disagreeingSource).toBe('orca-store')
      expect(decision.reason).not.toContain('ssh-keygen -R')
      expect(decision.reason).toContain('rebuilt')
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

    // Phase 1 has no dialog, so `ask` behaves as `accept-new` — deliberate, and the reason the
    // whole defence can ship without a modal. This pins the equivalence so Phase 2 has to break it
    // ON PURPOSE: `accept-new` must still not prompt, `ask` must.
    it('treats accept-new and ask alike while no dialog exists', () => {
      const acceptNew = decideHostKey(input({ strictHostKeyChecking: 'accept-new' }))
      const ask = decideHostKey(input({ strictHostKeyChecking: 'ask' }))
      expect(acceptNew.action).toBe('accept-and-remember')
      expect(ask.action).toBe(acceptNew.action)
    })

    // accept-new is a real OpenSSH value, not a typo — it must never fall into the strict branch.
    it('does not treat accept-new as strict', () => {
      expect(decideHostKey(input({ strictHostKeyChecking: 'accept-new' })).action).not.toBe(
        'reject'
      )
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

    // We could not read something that decides this — the system ssh_config, or a known_hosts file
    // that exists and will not open. Being laxer than ssh is the one outcome that is never
    // acceptable.
    it('denies an unknown host when a source could not be read', () => {
      expect(decideHostKey(input({ verificationSourcesIncomplete: true })).action).toBe('reject')
    })

    // Only NEW trust is withheld. A host we already know is decided before this is reached, so
    // being unable to read one source does not disconnect everything the user already verified.
    it('still accepts a known host when a source could not be read', () => {
      const decision = decideHostKey(
        input({ verificationSourcesIncomplete: true, knownHostsOutcome: 'match' })
      )
      expect(decision.action).toBe('accept')
    })

    // A VM provisioned a minute ago cannot be in known_hosts, so no policy — seen or unseen — is
    // satisfiable by it. Refusing would not make the connection safer, it would turn on-demand
    // runtimes off for everyone whose HOME diverges from their passwd home.
    it('still accepts an ephemeral target when a source could not be read', () => {
      const decision = decideHostKey(
        input({ isEphemeralRuntimeTarget: true, verificationSourcesIncomplete: true })
      )
      expect(decision.action).toBe('accept')
    })

    // The exception to the exception: an explicit StrictHostKeyChecking=yes is a policy we can
    // actually read and the user actually asked for, so it outranks the carve-out.
    it('denies an ephemeral target under an explicit StrictHostKeyChecking=yes', () => {
      const decision = decideHostKey(
        input({ isEphemeralRuntimeTarget: true, strictHostKeyChecking: 'yes' })
      )
      expect(decision.action).toBe('reject')
    })

    // The carve-out is about first contact only; a key that CHANGED is still a change.
    it('still rejects a changed key for an ephemeral target with sources incomplete', () => {
      const decision = decideHostKey(
        input({
          isEphemeralRuntimeTarget: true,
          verificationSourcesIncomplete: true,
          storeOutcome: 'mismatch'
        })
      )
      expect(decision.action).toBe('reject')
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
      { verificationSourcesIncomplete: true }
    ]
    for (const overrides of cases) {
      expect(decideHostKey(input(overrides)).action).not.toBe('prompt')
    }
  })
})
