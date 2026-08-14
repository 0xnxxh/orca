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
  storeOutcome: 'match' | 'mismatch' | 'unknown'
  /** Effective `StrictHostKeyChecking`; anything unrecognised is treated as `ask`. */
  strictHostKeyChecking: string
  /**
   * A freshly provisioned VM presents a new key every launch, so first contact is expected rather
   * than suspicious — and persisting would accumulate a record per launch.
   */
  isEphemeralRuntimeTarget: boolean
  /**
   * `ssh -G` ran on the HOME-divergent `-F` path, so /etc/ssh/ssh_config was suppressed and a
   * site-wide StrictHostKeyChecking may be invisible to us. Never be laxer than ssh would be.
   */
  siteConfigSuppressed: boolean
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

export function decideHostKey(input: HostKeyDecisionInput): HostKeyDecision {
  const {
    knownHostsOutcome,
    storeOutcome,
    isEphemeralRuntimeTarget,
    siteConfigSuppressed,
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
  if (knownHostsOutcome === 'unknown-type-known-host') {
    return {
      action: 'reject',
      outcome: 'unknown-type-known-host',
      disagreeingSource: 'known-hosts',
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
  if (siteConfigSuppressed) {
    // We could not read the system ssh_config, so we cannot prove a site policy does not forbid
    // this. Failing strict here is the only way to avoid being laxer than ssh.
    return {
      action: 'reject',
      outcome: 'unknown',
      reason: rejection(
        displayHost,
        'The host is unknown and the system SSH configuration could not be read, so its host key policy is unknown.'
      )
    }
  }
  if (isEphemeralRuntimeTarget) {
    // Expected to differ every launch; accepting without recording keeps the store from growing a
    // row per VM and keeps a stale record from ever becoming a spurious mismatch.
    return { action: 'accept', outcome: 'unknown' }
  }
  if (strict === 'no' || strict === 'off') {
    // OpenSSH accepts here but does not write. Persisting would silently convert a deliberately
    // lax setting into a permanent trust record.
    return { action: 'accept', outcome: 'unknown' }
  }
  return { action: 'accept-and-remember', outcome: 'unknown' }
}
