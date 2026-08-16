/**
 * The one vocabulary Orca uses to talk about whether a PTY is still running.
 *
 * `exited` requires positive evidence of absence from the owning host. Losing
 * contact with that host — an unregistered SSH provider, a dropped relay, an
 * inventory that only enumerates registered providers — is `unverifiable`, never
 * a death certificate and never a successful stop.
 */
export type PtyLivenessVerdict =
  | { status: 'exited' }
  | { status: 'live'; ptyIds: string[] }
  | { status: 'unverifiable'; reason: string }

export const SSH_PROVIDER_UNREGISTERED_REASON = 'its SSH provider is no longer registered'
export const NO_OBSERVING_PROVIDER_REASON = 'no registered provider can observe its host'

/** The one sentence every surface uses to admit a stop was not confirmed. */
export function describeUnconfirmedStop(reason: string): string {
  return `The PTY was not confirmed stopped: ${reason}.`
}

export const PTY_STILL_RUNNING_NOTE = 'The PTY is still running.'
