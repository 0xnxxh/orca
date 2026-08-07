// Error classes shared across the daemon protocol boundary (client, server,
// host). Split from types.ts, which is capped for wire-shape declarations.
export class TerminalAttachCanceledError extends Error {
  constructor(sessionId: string) {
    super(`Attach canceled for session ${sessionId}`)
    this.name = 'TerminalAttachCanceledError'
  }
}

export class DaemonProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DaemonProtocolError'
  }
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`)
    this.name = 'SessionNotFoundError'
  }
}

export class TerminalSessionOwnerUnverifiedError extends Error {
  constructor(sessionId: string) {
    super(`Terminal session owner could not be verified: ${sessionId}`)
    this.name = 'TerminalSessionOwnerUnverifiedError'
  }
}

export class TerminalHostGoneError extends Error {
  constructor(sessionId: string) {
    super(`Terminal host that owned session ${sessionId} is gone`)
    this.name = 'TerminalHostGoneError'
  }
}

/**
 * A connect-time ENOENT/ECONNREFUSED proves the endpoint is absent rather than busy — on Windows a
 * named pipe disappears with its server process — so the daemon that owned the session is gone. Reaching
 * a caller at all means respawn-and-retry already failed or was unavailable (legacy adapters never respawn).
 */
export function isDaemonEndpointGoneError(err: unknown): boolean {
  const candidate = err as { code?: unknown; syscall?: unknown } | null
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    candidate.syscall === 'connect' &&
    (candidate.code === 'ENOENT' || candidate.code === 'ECONNREFUSED')
  )
}

export function decodeDaemonResponseError(message: string): Error {
  const prefix = 'Session not found: '
  return message.startsWith(prefix)
    ? new SessionNotFoundError(message.slice(prefix.length))
    : new DaemonProtocolError(message)
}
