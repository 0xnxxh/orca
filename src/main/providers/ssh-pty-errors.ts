export const SSH_SESSION_EXPIRED_ERROR = 'SSH_SESSION_EXPIRED'
export const SSH_PTY_IDENTITY_MISMATCH_ERROR = 'SSH_PTY_IDENTITY_MISMATCH'
// Why: delivery could not be resumed. The relay does not report exited, so this must never
// be relabelled as expiry — that retires a live remote session and cold-starts a duplicate.
export const SSH_PTY_RESTORE_REQUIRED_ERROR = 'SSH_PTY_RESTORE_REQUIRED'

export function isSshPtyNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /PTY ".+" not found/i.test(message)
}

export function isSshPtyRestoreRequiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes(SSH_PTY_RESTORE_REQUIRED_ERROR)
}

export function isSshPtyIdentityMismatchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes(SSH_PTY_IDENTITY_MISMATCH_ERROR) || /identity mismatch/i.test(message)
}
