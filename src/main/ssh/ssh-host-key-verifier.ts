/**
 * Builds the ssh2 `hostVerifier` and the host-key algorithm order that makes it safe.
 *
 * Separated from `SshConnection` so the decision path can be tested without a handshake, and so the
 * two halves that must ship together — type-scoped matching and algorithm ordering — live in one
 * file where the dependency is visible.
 *
 * See docs/reference/ssh-host-key-verification.md.
 */
import { createHash } from 'node:crypto'
import {
  formatHostKeyFingerprint,
  matchKnownHosts,
  readHostKeyType,
  type KnownHostsEntry
} from './ssh-known-hosts'
import { decideHostKey, type HostKeyDecision } from './ssh-host-key-decision'

export type TrustedHostKeyLookup = (query: {
  host: string
  port: number
  keyType: string
  key: Buffer
}) => 'match' | 'mismatch' | 'unknown'

export type HostKeyVerifierDeps = {
  host: string
  port: number
  displayHost: string
  strictHostKeyChecking: string
  isEphemeralRuntimeTarget: boolean
  siteConfigSuppressed: boolean
  /** Already unioned across every known_hosts file. */
  entries: readonly KnownHostsEntry[]
  isTrusted: TrustedHostKeyLookup
  rememberHostKey: (record: {
    host: string
    port: number
    keyType: string
    key: Buffer
    fingerprint: string
  }) => void
  /** Called on every decision so accepts and rejections are auditable. */
  onDecision?: (decision: HostKeyDecision & { fingerprint: string; keyType: string }) => void
}

export function hostKeyFingerprintOf(key: Buffer): string {
  return formatHostKeyFingerprint(createHash('sha256').update(key).digest('base64'))
}

/**
 * Host-key algorithms to propose, ordered so the types we already hold for this host come first.
 *
 * This is what makes type-scoped matching safe rather than a downgrade. RFC 4253 gives the client's
 * order priority, so leading with the known types denies a server the choice of presenting some
 * other type to convert a hard failure into first contact. Without this, an attacker who cannot
 * forge the key on file simply offers a different algorithm.
 *
 * Returns undefined when we know nothing for the host, leaving ssh2's defaults alone.
 */
export function orderServerHostKeyAlgorithms(
  entries: readonly KnownHostsEntry[],
  host: string,
  port: number,
  supported: readonly string[]
): string[] | undefined {
  const known = new Set<string>()
  for (const entry of entries) {
    if (entry.marker === 'revoked') {
      continue
    }
    // Reuse the matcher's own host logic rather than re-implementing pattern/hash matching here.
    const outcome = matchKnownHosts([entry], {
      host,
      port,
      keyType: entry.keyType,
      key: entry.key
    })
    if (outcome === 'match') {
      known.add(entry.keyType)
    }
  }
  if (known.size === 0) {
    return undefined
  }
  const preferred = supported.filter((algorithm) => known.has(algorithm))
  if (preferred.length === 0) {
    return undefined
  }
  return [...preferred, ...supported.filter((algorithm) => !known.has(algorithm))]
}

export type VerifyCallback = (accept: boolean) => void

/**
 * The ssh2 `hostVerifier`.
 *
 * MUST be a plain function that returns `undefined`. ssh2 does
 * `const ret = hostVerifier(key, verify); if (ret !== undefined) verify(ret)` — so an `async`
 * function returns a Promise, which is neither undefined nor falsy, and ssh2 accepts the key
 * immediately while ignoring whatever the callback later decides. Making this async would silently
 * restore the accept-everything behaviour this module exists to remove.
 */
export function createHostKeyVerifier(
  deps: HostKeyVerifierDeps
): (key: Buffer, verify: VerifyCallback) => undefined {
  return (key, verify) => {
    try {
      const keyType = readHostKeyType(key)
      if (!keyType) {
        // A key whose own header we cannot read is not something to reason about further.
        verify(false)
        return undefined
      }
      const fingerprint = hostKeyFingerprintOf(key)
      const decision = decideHostKey({
        knownHostsOutcome: matchKnownHosts(deps.entries, {
          host: deps.host,
          port: deps.port,
          keyType,
          key
        }),
        storeOutcome: deps.isTrusted({ host: deps.host, port: deps.port, keyType, key }),
        strictHostKeyChecking: deps.strictHostKeyChecking,
        isEphemeralRuntimeTarget: deps.isEphemeralRuntimeTarget,
        siteConfigSuppressed: deps.siteConfigSuppressed,
        displayHost: deps.displayHost
      })

      deps.onDecision?.({ ...decision, fingerprint, keyType })

      if (decision.action === 'accept-and-remember') {
        deps.rememberHostKey({
          host: deps.host,
          port: deps.port,
          keyType,
          key,
          fingerprint
        })
      }
      // `prompt` is unreachable in this phase; treating it as a denial keeps the fail-closed
      // property if it ever becomes reachable before the dialog exists.
      verify(decision.action === 'accept' || decision.action === 'accept-and-remember')
    } catch {
      // ssh2 may not catch a throw from inside the verifier, which would leave the handshake
      // hanging rather than failing. Denying is the only safe outcome for an error we cannot
      // interpret.
      verify(false)
    }
    return undefined
  }
}
