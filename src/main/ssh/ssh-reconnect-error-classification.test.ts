import { describe, it, expect } from 'vitest'
import { isTransientError } from './ssh-connection-utils'
import { isTransientReconnectError } from './ssh-reconnect-error-classification'

describe('isTransientReconnectError', () => {
  it('treats the system SSH connect timeout as recoverable', () => {
    const err = new Error('System SSH connection timed out')
    // Guards the split: widening isTransientError would spend 5 connect() attempts on this.
    expect(isTransientError(err)).toBe(false)
    expect(isTransientReconnectError(err)).toBe(true)
  })

  it.each([
    'System SSH probe failed (exit 255). stderr: ssh: connect to host box port 22: Connection refused',
    'System SSH probe failed (exit 255). stderr: ssh: connect to host box port 22: No route to host',
    'System SSH probe failed (exit 255). stderr: ssh: connect to host box port 22: Network is unreachable',
    'System SSH probe failed (exit 255). stderr: kex_exchange_identification: read: Connection reset by peer',
    'System SSH probe failed (exit 255). stderr: ssh: Could not resolve hostname box: Name or service not known'
  ])('treats OpenSSH network prose as recoverable: %s', (message) => {
    expect(isTransientReconnectError(new Error(message))).toBe(true)
  })

  it('keeps credential failures permanent', () => {
    expect(
      isTransientReconnectError(new Error('All configured authentication methods failed'))
    ).toBe(false)
    expect(
      isTransientReconnectError(
        new Error('System SSH probe failed (exit 255). stderr: Permission denied (publickey).')
      )
    ).toBe(false)
    expect(
      isTransientReconnectError(
        new Error('Encrypted private OpenSSH key detected, but no passphrase given')
      )
    ).toBe(false)
  })

  it('still covers the errno codes isTransientError already matched', () => {
    const err = new Error('refused') as NodeJS.ErrnoException
    err.code = 'ECONNREFUSED'
    expect(isTransientReconnectError(err)).toBe(true)
  })

  it('keeps unrelated failures permanent', () => {
    expect(isTransientReconnectError(new Error('something went wrong'))).toBe(false)
  })
})
