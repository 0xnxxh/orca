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
  constructor() {
    super('terminal_host_gone')
    this.name = 'TerminalHostGoneError'
  }
}

/**
 * A daemon token file that is gone after this client was authenticated to that daemon. Only a
 * daemon's own shutdown unlinks the token, so the endpoint it named is provably retired.
 *
 * Keeps the errno shape of the underlying `open` failure: recovery paths that retry a respawn on a
 * missing token match on `code`/`syscall`, and they must keep winning over this classification.
 */
export class DaemonEndpointTokenGoneError extends Error implements NodeJS.ErrnoException {
  readonly code = 'ENOENT'
  readonly syscall = 'open'
  readonly path: string

  constructor(tokenPath: string, cause: unknown) {
    super(`ENOENT: no such file or directory, open '${tokenPath}'`, { cause })
    this.name = 'DaemonEndpointTokenGoneError'
    this.path = tokenPath
  }
}

// Connect ENOENT/ECONNREFUSED proves the endpoint is absent. A bare open ENOENT does not — an
// unread token can still front a live daemon — so only the authenticated-disconnect form counts.
export function isDaemonEndpointGoneError(err: unknown): boolean {
  if (err instanceof DaemonEndpointTokenGoneError) {
    return true
  }
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
