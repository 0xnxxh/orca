import { describe, expect, it } from 'vitest'
import {
  assertTerminalAuthorityNamespaceLocator,
  terminalAuthorityNamespaceLocatorKey
} from './terminal-session-authority-locator'

describe('terminal authority namespace locator', () => {
  it('keys host-canonical workspace paths without client routing identity', () => {
    expect(
      terminalAuthorityNamespaceLocatorKey({
        kind: 'workspace',
        canonicalPath: '/srv/repo',
        pathFlavor: 'posix'
      })
    ).toBe('["workspace","posix","/srv/repo"]')
    expect(terminalAuthorityNamespaceLocatorKey({ kind: 'floating' })).toBe('["floating"]')
  })

  it('preserves POSIX case and Windows canonical case', () => {
    expect(
      terminalAuthorityNamespaceLocatorKey({
        kind: 'workspace',
        canonicalPath: '/srv/Repo',
        pathFlavor: 'posix'
      })
    ).not.toBe(
      terminalAuthorityNamespaceLocatorKey({
        kind: 'workspace',
        canonicalPath: '/srv/repo',
        pathFlavor: 'posix'
      })
    )
    expect(() =>
      assertTerminalAuthorityNamespaceLocator({
        kind: 'workspace',
        canonicalPath: 'C:/Users/Alice/repo',
        pathFlavor: 'windows'
      })
    ).not.toThrow()
  })

  it('rejects relative, control-character, and malformed Windows locators', () => {
    expect(() =>
      assertTerminalAuthorityNamespaceLocator({
        kind: 'workspace',
        canonicalPath: 'repo',
        pathFlavor: 'posix'
      })
    ).toThrow('absolute')
    expect(() =>
      assertTerminalAuthorityNamespaceLocator({
        kind: 'workspace',
        canonicalPath: '/srv/repo\nother',
        pathFlavor: 'posix'
      })
    ).toThrow('invalid')
    expect(() =>
      assertTerminalAuthorityNamespaceLocator({
        kind: 'workspace',
        canonicalPath: '/Users/Alice/repo',
        pathFlavor: 'windows'
      })
    ).toThrow('Windows')
  })
})
