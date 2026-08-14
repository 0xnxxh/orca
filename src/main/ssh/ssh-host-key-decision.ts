/**
 * What to do about a presented host key.
 *
 * Kept separate from the ssh2 wiring so the policy is testable without a handshake, and injected
 * rather than importing its sources so a test states its own trust state instead of writing files.
 * See docs/reference/ssh-host-key-verification.md.
 */
import type { KnownHostsOutcome } from './ssh-known-hosts'

/** Phase 1 ships no dialog; `prompt` is reserved for Phase 2 and never produced today. */
export type HostKeyAction = 'accept' | 'accept-and-remember' | 'reject' | 'prompt'

export type HostKeyDecision = {
  action: HostKeyAction
  outcome: KnownHostsOutcome
  /** Which source disagreed, so the failure message can point at a remedy that exists. */
  disagreeingSource?: 'orca-store' | 'known-hosts'
  /** Non-null only when the connection must fail; already user-facing. */
  reason?: string
}

export type HostKeyDecisionInput = {
  /** From the user's known_hosts files, unioned. */
  knownHostsOutcome: KnownHostsOutcome
  /** From our own store: does it already hold this exact key for host+port+type? */
  storeOutcome: 'match' | 'mismatch' | 'unknown-type-known-host' | 'unknown'
  /** Effective `StrictHostKeyChecking`; anything unrecognised is treated as `ask`. */
  strictHostKeyChecking: string
  /**
   * A freshly provisioned VM presents a new key every launch, so first contact is expected rather
   * than suspicious — and persisting would accumulate a record per launch.
   */
  isEphemeralRuntimeTarget: boolean
  /**
   * Something that decides this was unreadable, so we cannot prove we are seeing what ssh sees:
   * `ssh -G` ran on the HOME-divergent `-F` path and suppressed a possible site-wide
   * StrictHostKeyChecking, or a known_hosts file exists and would not open. Extending NEW trust
   * while blind is the one outcome that is never acceptable — a host we already know still
   * connects, because a match is decided before this is consulted.
   */
  verificationSourcesIncomplete: boolean
  displayHost: string
}

const CHANGED_KEY_HINT =
  'If you rebuilt or reprovisioned this machine, remove the saved key and reconnect.'

/**
 * Deliberately avoids the words "authentication failed" and "permission denied": the reconnect
 * ladder classifies on those substrings, and a denial that reads as an auth error gets retried
 * forever against a decision that will never change.
 */
function rejection(displayHost: string, detail: string): string {
  return `Host key verification failed for ${displayHost}. ${detail}`
}

/**
 * A denied host key, carried as a type rather than sniffed from the message.
 *
 * The connect path must recognise this before it offers any credential: prompting for a passphrase
 * or a password after we have decided the host may be impersonated is the one thing a host key check
 * exists to prevent — the user types the secret straight into whatever answered. Substring matching
 * would tie that to wording that the reason strings deliberately keep changing.
 */
export class HostKeyVerificationError extends Error {
  readonly outcome: KnownHostsOutcome

  constructor(message: string, outcome: KnownHostsOutcome) {
    super(message)
    this.name = 'HostKeyVerificationError'
    this.outcome = outcome
  }
}

export function isHostKeyVerificationError(err: unknown): err is HostKeyVerificationError {
  return err instanceof HostKeyVerificationError
}

export function decideHostKey(input: HostKeyDecisionInput): HostKeyDecision {
  const {
    knownHostsOutcome,
    storeOutcome,
    isEphemeralRuntimeTarget,
    verificationSourcesIncomplete,
    displayHost
  } = input
  const strict = input.strictHostKeyChecking.toLowerCase()

  // Revocation outranks everything, including StrictHostKeyChecking=no. A revoked key is a
  // statement that this key is known-bad, not merely unrecognised.
  if (knownHostsOutcome === 'revoked') {
    return {
      action: 'reject',
      outcome: 'revoked',
      disagreeingSource: 'known-hosts',
      reason: rejection(displayHost, 'This host key has been revoked.')
    }
  }

  // Either source holding a different key for this host and type is a change. known_hosts is named
  // first because its remedy (ssh-keygen -R) is the one that also unblocks ssh and git.
  if (knownHostsOutcome === 'mismatch') {
    return {
      action: 'reject',
      outcome: 'mismatch',
      disagreeingSource: 'known-hosts',
      reason: rejection(
        displayHost,
        `The key does not match the entry in your known_hosts file. ssh and git will refuse this host too. Run: ssh-keygen -R ${displayHost}`
      )
    }
  }
  if (storeOutcome === 'mismatch') {
    return {
      action: 'reject',
      outcome: 'mismatch',
      disagreeingSource: 'orca-store',
      reason: rejection(
        displayHost,
        `The key changed since you last connected. ${CHANGED_KEY_HINT}`
      )
    }
  }

  if (knownHostsOutcome === 'match' || storeOutcome === 'match') {
    return { action: 'accept', outcome: 'match' }
  }

  if (knownHostsOutcome === 'ca-only') {
    return {
      action: 'reject',
      outcome: 'ca-only',
      disagreeingSource: 'known-hosts',
      reason: rejection(
        displayHost,
        'This host is protected by a certificate authority, which this connection type cannot verify. Set ORCA_SSH_FORCE_SYSTEM_TRANSPORT=1 to connect using your system ssh.'
      )
    }
  }

  // We hold a key for this host, just not of the presented type. Treating that as first contact is
  // the downgrade an attacker who cannot forge the known key would reach for.
  if (
    knownHostsOutcome === 'unknown-type-known-host' ||
    storeOutcome === 'unknown-type-known-host'
  ) {
    return {
      action: 'reject',
      outcome: 'unknown-type-known-host',
      disagreeingSource:
        knownHostsOutcome === 'unknown-type-known-host' ? 'known-hosts' : 'orca-store',
      reason: rejection(
        displayHost,
        'The host offered a key of a type we have not seen for it before, while a key of another type is already known. This can mean the host was rebuilt, or that something is impersonating it.'
      )
    }
  }

  // Unknown from here down.
  if (strict === 'yes' || strict === 'always') {
    return {
      action: 'reject',
      outcome: 'unknown',
      reason: rejection(
        displayHost,
        'The host is not listed in your known_hosts file and StrictHostKeyChecking is enabled.'
      )
    }
  }
  // Deliberately ABOVE the incomplete-sources check, and deliberately BELOW explicit strict.
  //
  // A machine provisioned a minute ago cannot be in known_hosts, by construction — no policy, seen
  // or unseen, can be satisfied by it. So refusing here would not make the connection safer, it
  // would turn on-demand runtimes off entirely for anyone whose HOME diverges from their passwd
  // home (sandboxes, E2E isolation), and the reason we would print names a config file they cannot
  // fix. Incomplete sources is a statement that we might be missing a policy; it is not a policy.
  // An EXPLICIT StrictHostKeyChecking=yes still wins above, because that one we can actually read
  // and the user asked for it.
  //
  // Accepting without recording is the rest of it: a new key every launch would otherwise grow a
  // row per VM, and a stale row eventually reads as a mismatch against a host that did nothing
  // wrong.
  if (isEphemeralRuntimeTarget) {
    return { action: 'accept', outcome: 'unknown' }
  }
  if (verificationSourcesIncomplete) {
    // We could not read something that decides this, so we cannot prove a policy does not forbid it
    // or that a known_hosts entry does not contradict it. Refusing to extend NEW trust while blind
    // is the only way to avoid being laxer than ssh.
    return {
      action: 'reject',
      outcome: 'unknown',
      reason: rejection(
        displayHost,
        'The host is unknown and part of the SSH configuration could not be read, so its host key policy cannot be checked.'
      )
    }
  }
  if (strict === 'no' || strict === 'off') {
    // OpenSSH accepts here but does not write. Persisting would silently convert a deliberately
    // lax setting into a permanent trust record.
    return { action: 'accept', outcome: 'unknown' }
  }
  return { action: 'accept-and-remember', outcome: 'unknown' }
}
