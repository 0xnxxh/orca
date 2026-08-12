// Why shared: main publishes these tokens and the renderer decides whether to
// respawn on them. They lived in two places, and the copies disagreed about
// what an identity mismatch meant — main marked it, the renderer ignored the
// mark and respawned a live shell. One definition, so a change reaches both.

/** The host proved the session is gone. Callers may respawn. */
export const SSH_SESSION_EXPIRED_ERROR = 'SSH_SESSION_EXPIRED'

/** The relay FOUND the pty and its recorded pane differs, so the shell is
 *  running. The relay words this as "not found", which is why matching on that
 *  phrasing alone reads a live shell as a dead one. Never grounds a respawn. */
export const SSH_PTY_IDENTITY_MISMATCH_ERROR = 'SSH_PTY_IDENTITY_MISMATCH'

/** The shell is alive; only its output source must be re-established. */
export const SSH_SOURCE_RESTORE_REQUIRED_ERROR = 'SSH_SOURCE_RESTORE_REQUIRED'

/**
 * The relay WATCHED this shell exit. That is first-hand knowledge from the process that owned it,
 * and the only answer that proves death: a relay which merely never knew the id may be a
 * replacement whose predecessor's shells are still running.
 *
 * Deliberately worded so it cannot be mistaken for the ordinary unknown — the phrase
 * `PTY "<id>" not found` is what an older client maps to expiry, and expiry authorizes a respawn.
 */
export const SSH_PTY_EXITED_ERROR = 'SSH_PTY_EXITED'

/** The carrier is the message: the relay's error transport drops structured payloads. */
export function formatPtyExitedError(id: string, code: number, incarnationId: string): string {
  return `${SSH_PTY_EXITED_ERROR}: ${id} code=${code} incarnation=${incarnationId}`
}

export function isSshPtyExitedMessage(message: string): boolean {
  return message.includes(SSH_PTY_EXITED_ERROR)
}

export function isSshPtyIdentityMismatchMessage(message: string): boolean {
  return message.includes(SSH_PTY_IDENTITY_MISMATCH_ERROR) || /identity mismatch/i.test(message)
}
