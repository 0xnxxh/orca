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

export function isSshPtyIdentityMismatchMessage(message: string): boolean {
  return message.includes(SSH_PTY_IDENTITY_MISMATCH_ERROR) || /identity mismatch/i.test(message)
}
