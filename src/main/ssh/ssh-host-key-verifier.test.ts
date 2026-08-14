import { describe, expect, it, vi } from 'vitest'
import { parseKnownHosts } from './ssh-known-hosts'
import {
  createHostKeyVerifier,
  hostKeyFingerprintOf,
  orderServerHostKeyAlgorithms,
  type HostKeyVerifierDeps
} from './ssh-host-key-verifier'

const ED_A = 'AAAAC3NzaC1lZDI1NTE5AAAAIKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
const ED_B = 'AAAAC3NzaC1lZDI1NTE5AAAAILu7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7'
const RSA_A =
  'AAAAB3NzaC1yc2EAAABAzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzA=='

const blob = (base64: string): Buffer => Buffer.from(base64, 'base64')

function deps(overrides: Partial<HostKeyVerifierDeps> = {}): HostKeyVerifierDeps {
  return {
    host: 'example.com',
    port: 22,
    displayHost: 'example.com',
    strictHostKeyChecking: 'ask',
    isEphemeralRuntimeTarget: false,
    siteConfigSuppressed: false,
    entries: [],
    isTrusted: () => 'unknown',
    rememberHostKey: vi.fn(),
    ...overrides
  }
}

/** Runs the verifier synchronously and reports both the decision and what it returned. */
function run(
  overrides: Partial<HostKeyVerifierDeps>,
  key = ED_A
): { accepted: boolean | undefined; returned: unknown } {
  let accepted: boolean | undefined
  const verifier = createHostKeyVerifier(deps(overrides))
  const returned = verifier(blob(key), (ok) => {
    accepted = ok
  })
  return { accepted, returned }
}

describe('the ssh2 host key verifier', () => {
  // The regression that would silently restore accept-everything: ssh2 does
  // `const ret = verifier(key, verify); if (ret !== undefined) verify(ret)`, so any non-undefined
  // return — notably the Promise from an `async` function — accepts before the callback decides.
  it('returns nothing, so ssh2 waits for the callback', () => {
    expect(run({}).returned).toBeUndefined()
  })

  it('accepts a key the user already has in known_hosts', () => {
    const entries = parseKnownHosts(`example.com ssh-ed25519 ${ED_A}`)
    expect(run({ entries }).accepted).toBe(true)
  })

  it('accepts a key our own store already holds', () => {
    expect(run({ isTrusted: () => 'match' }).accepted).toBe(true)
  })

  it('rejects a changed key', () => {
    const entries = parseKnownHosts(`example.com ssh-ed25519 ${ED_B}`)
    expect(run({ entries }).accepted).toBe(false)
  })

  it('rejects a revoked key', () => {
    const entries = parseKnownHosts(`@revoked example.com ssh-ed25519 ${ED_A}`)
    expect(run({ entries }).accepted).toBe(false)
  })

  it('rejects a key whose own header cannot be read', () => {
    let accepted: boolean | undefined
    createHostKeyVerifier(deps())(Buffer.alloc(2), (ok) => {
      accepted = ok
    })
    expect(accepted).toBe(false)
  })

  // ssh2 may not catch a throw from inside the verifier, which would hang the handshake instead of
  // failing it.
  it('denies rather than throwing when a dependency fails', () => {
    const { accepted, returned } = run({
      isTrusted: () => {
        throw new Error('store unreadable')
      }
    })
    expect(accepted).toBe(false)
    expect(returned).toBeUndefined()
  })

  describe('remembering', () => {
    it('records a first-contact key', () => {
      const rememberHostKey = vi.fn()
      run({ rememberHostKey })
      expect(rememberHostKey).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'example.com',
          port: 22,
          keyType: 'ssh-ed25519',
          fingerprint: hostKeyFingerprintOf(blob(ED_A))
        })
      )
    })

    it.each([
      ['a key we already know', { entries: parseKnownHosts(`example.com ssh-ed25519 ${ED_A}`) }],
      ['a rejected key', { entries: parseKnownHosts(`example.com ssh-ed25519 ${ED_B}`) }],
      ['an ephemeral runtime target', { isEphemeralRuntimeTarget: true }],
      ['a lax StrictHostKeyChecking', { strictHostKeyChecking: 'no' }]
    ])('does not record %s', (_label, overrides) => {
      const rememberHostKey = vi.fn()
      run({ ...overrides, rememberHostKey })
      expect(rememberHostKey).not.toHaveBeenCalled()
    })
  })

  it('reports every decision for audit', () => {
    const onDecision = vi.fn()
    run({ onDecision })
    expect(onDecision).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'unknown', keyType: 'ssh-ed25519' })
    )
  })
})

describe('host key algorithm ordering', () => {
  const supported = ['ssh-ed25519', 'rsa-sha2-512', 'ssh-rsa', 'ecdsa-sha2-nistp256']

  // Without this, type-scoped matching is a downgrade: an attacker who cannot forge the key on
  // file just presents another type and turns a hard failure into first contact.
  it('leads with the types already known for the host', () => {
    const entries = parseKnownHosts(`example.com ssh-rsa ${RSA_A}`)
    const ordered = orderServerHostKeyAlgorithms(entries, 'example.com', 22, supported)
    // Any RSA algorithm leading is the property that matters; which one is ssh2 preference order.
    expect(ordered?.[0]).toMatch(/rsa/)
    expect(ordered?.indexOf('ssh-ed25519')).toBeGreaterThan(0)
  })

  it('keeps every supported algorithm, only reordered', () => {
    const entries = parseKnownHosts(`example.com ssh-rsa ${RSA_A}`)
    const ordered = orderServerHostKeyAlgorithms(entries, 'example.com', 22, supported)
    expect([...(ordered ?? [])].sort()).toEqual([...supported].sort())
  })

  it('leaves the defaults alone for a host we know nothing about', () => {
    const entries = parseKnownHosts(`other.com ssh-rsa ${RSA_A}`)
    expect(orderServerHostKeyAlgorithms(entries, 'example.com', 22, supported)).toBeUndefined()
  })

  it('ignores a revoked entry when choosing what to lead with', () => {
    const entries = parseKnownHosts(`@revoked example.com ssh-rsa ${RSA_A}`)
    expect(orderServerHostKeyAlgorithms(entries, 'example.com', 22, supported)).toBeUndefined()
  })

  // One ssh-rsa key is negotiated as rsa-sha2-512/256 or ssh-rsa, so promoting only the literal
  // name would leave a known RSA host ordered behind ed25519 — the exact gap this closes.
  it('promotes every RSA signature algorithm for a known ssh-rsa key', () => {
    const entries = parseKnownHosts(`example.com ssh-rsa ${RSA_A}`)
    const ordered = orderServerHostKeyAlgorithms(entries, 'example.com', 22, supported)
    expect(ordered?.slice(0, 2).sort()).toEqual(['rsa-sha2-512', 'ssh-rsa'])
    expect(ordered?.indexOf('ssh-ed25519')).toBeGreaterThan(1)
  })

  it('does not propose a type the transport does not support', () => {
    const entries = parseKnownHosts(`example.com ssh-ed25519 ${ED_A}`)
    const ordered = orderServerHostKeyAlgorithms(entries, 'example.com', 22, ['rsa-sha2-512'])
    expect(ordered).toBeUndefined()
  })
})
