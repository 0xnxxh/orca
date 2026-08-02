const CANCELLED_CONNECT_ATTEMPT_MESSAGE = 'SSH connection attempt was cancelled'
const CANCELLED_CONNECT_ATTEMPT_NAME = 'SshConnectAttemptCancelledError'

// Why: cancellation means a newer attempt (or disconnect) already owns the connection, so it must be
// recognisable by identity — publishing its message as a permanent error hides the live attempt.
export function createCancelledConnectAttemptError(): Error {
  const error = new Error(CANCELLED_CONNECT_ATTEMPT_MESSAGE)
  error.name = CANCELLED_CONNECT_ATTEMPT_NAME
  return error
}

export function isCancelledConnectAttemptError(err: Error): boolean {
  return (
    err.name === CANCELLED_CONNECT_ATTEMPT_NAME || err.message === CANCELLED_CONNECT_ATTEMPT_MESSAGE
  )
}
