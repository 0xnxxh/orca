import { describe, expect, it } from 'vitest'
import type { RequestContext } from './dispatcher'
import {
  assertAuthenticatedTerminalAuthorityControl,
  parseTerminalAuthorityWorktreeRemovalParams
} from './terminal-authority-control-protocol'

function context(overrides: Partial<NonNullable<RequestContext['sessionIdentity']>> = {}) {
  return {
    clientId: 1,
    isStale: () => false,
    sessionIdentity: {
      principal: 'terminal-authority:host-1',
      authenticated: true,
      allowSessionOwner: true,
      authenticationKind: 'endpoint-credential' as const,
      ...overrides
    }
  } satisfies RequestContext
}

describe('terminal authority control protocol', () => {
  it('admits only an endpoint-authenticated authority principal', () => {
    expect(() => assertAuthenticatedTerminalAuthorityControl(context())).not.toThrow()
    expect(() =>
      assertAuthenticatedTerminalAuthorityControl(context({ authenticated: false }))
    ).toThrow('not_authenticated')
    expect(() =>
      assertAuthenticatedTerminalAuthorityControl(context({ principal: 'relay-endpoint:build' }))
    ).toThrow('not_authenticated')
  })

  it('accepts bounded removal identities and rejects ambiguous payloads', () => {
    expect(
      parseTerminalAuthorityWorktreeRemovalParams({
        leaseToken: 'control-17',
        rootPath: 'C:\\Repo'
      })
    ).toEqual({ leaseToken: 'control-17', rootPath: 'C:\\Repo' })

    for (const params of [
      { leaseToken: '../escape', rootPath: '/repo' },
      { leaseToken: 'lease-1', rootPath: '' },
      { leaseToken: 'lease-1', rootPath: '/repo\0nested' },
      { leaseToken: 'lease-1', rootPath: 'relative/repo' }
    ]) {
      expect(() => parseTerminalAuthorityWorktreeRemovalParams(params)).toThrow('invalid')
    }
  })
})
