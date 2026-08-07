import { describe, expect, it } from 'vitest'
import {
  DaemonProtocolError,
  decodeDaemonResponseError,
  isDaemonEndpointGoneError,
  SessionNotFoundError
} from './daemon-errors'

function socketError(code: string, syscall: string): Error & { code: string; syscall: string } {
  return Object.assign(new Error(`${syscall} ${code}`), { code, syscall })
}

describe('decodeDaemonResponseError', () => {
  it('types the exact legacy session-absence response', () => {
    expect(decodeDaemonResponseError('Session not found: pty-1')).toBeInstanceOf(
      SessionNotFoundError
    )
  })

  it('keeps unrelated daemon failures non-authoritative', () => {
    expect(decodeDaemonResponseError('proxy failed: Session not found: pty-1')).toBeInstanceOf(
      DaemonProtocolError
    )
  })
})

/**
 * On Windows a named pipe vanishes with its server process, so `connect ENOENT
 * \\?\pipe\orca-terminal-host-vNN-…` is proof the owning daemon died — it used to reach the user raw.
 */
describe('isDaemonEndpointGoneError', () => {
  it('recognizes a missing Windows named pipe', () => {
    const err = Object.assign(
      new Error('connect ENOENT \\\\?\\pipe\\orca-terminal-host-v30-14cb7f94b511'),
      { code: 'ENOENT', syscall: 'connect' }
    )
    expect(isDaemonEndpointGoneError(err)).toBe(true)
  })

  it('recognizes a refused socket', () => {
    expect(isDaemonEndpointGoneError(socketError('ECONNREFUSED', 'connect'))).toBe(true)
  })

  it('ignores a missing token file, which does not prove the endpoint is gone', () => {
    // Why: ENOENT on open is the token path, and an initially missing token can still hide a live daemon.
    expect(isDaemonEndpointGoneError(socketError('ENOENT', 'open'))).toBe(false)
  })

  it('ignores connect failures that are not proof of absence', () => {
    for (const code of ['ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'EACCES']) {
      expect(isDaemonEndpointGoneError(socketError(code, 'connect'))).toBe(false)
    }
  })

  it('ignores non-socket errors and non-objects', () => {
    expect(isDaemonEndpointGoneError(new Error('Connection lost'))).toBe(false)
    expect(isDaemonEndpointGoneError('connect ENOENT')).toBe(false)
    expect(isDaemonEndpointGoneError(null)).toBe(false)
    expect(isDaemonEndpointGoneError(undefined)).toBe(false)
  })
})
