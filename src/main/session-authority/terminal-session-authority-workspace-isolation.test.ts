import { createHash } from 'node:crypto'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertTerminalAuthorityNamespaceLocator,
  terminalAuthorityNamespaceLocatorKey
} from '../../shared/terminal-session-authority-locator'
import { terminalSessionAuthorityNamespaceDirectory } from './terminal-session-authority-namespace-directory'
import {
  terminalAuthorityFloatingLocator,
  terminalAuthorityWorkspaceLocator
} from './terminal-session-authority-workspace-locator'

const MAX_CANONICAL_PATH_BYTES = 32 * 1024

describe('terminal authority workspace isolation', () => {
  it('canonicalizes POSIX, Windows drive, UNC, and device-prefix aliases on the host', () => {
    const posix = terminalAuthorityWorkspaceLocator('/client/repo-link/', {
      pathFlavor: 'posix',
      realpath: () => '/srv/account/repo/',
      isDirectory: () => true
    })
    const drive = terminalAuthorityWorkspaceLocator('C:\\Users\\Alice\\repo\\', {
      pathFlavor: 'windows',
      realpath: () => '\\\\?\\C:\\Users\\Alice\\repo\\',
      isDirectory: () => true
    })
    const deviceDrive = terminalAuthorityWorkspaceLocator('\\\\?\\C:\\Users\\Alice\\repo\\', {
      pathFlavor: 'windows',
      realpath: () => 'C:\\Users\\Alice\\repo',
      isDirectory: () => true
    })
    const unc = terminalAuthorityWorkspaceLocator('\\\\server\\share\\repo\\', {
      pathFlavor: 'windows',
      realpath: () => '\\\\?\\UNC\\Server\\Share\\repo\\',
      isDirectory: () => true
    })

    expect(posix).toMatchObject({ canonicalPath: '/srv/account/repo' })
    expect(drive).toMatchObject({ canonicalPath: 'C:/Users/Alice/repo' })
    expect(terminalAuthorityNamespaceLocatorKey(deviceDrive)).toBe(
      terminalAuthorityNamespaceLocatorKey(drive)
    )
    expect(unc).toMatchObject({ canonicalPath: '//Server/Share/repo' })
  })

  it('keeps POSIX, Windows, injected delimiters, and floating namespaces distinct', () => {
    const keys = [
      terminalAuthorityNamespaceLocatorKey({
        kind: 'workspace',
        canonicalPath: '/C:/repo',
        pathFlavor: 'posix'
      }),
      terminalAuthorityNamespaceLocatorKey({
        kind: 'workspace',
        canonicalPath: 'C:/repo',
        pathFlavor: 'windows'
      }),
      terminalAuthorityNamespaceLocatorKey({
        kind: 'workspace',
        canonicalPath: '/C:/repo","windows","C:/repo',
        pathFlavor: 'posix'
      }),
      terminalAuthorityNamespaceLocatorKey(terminalAuthorityFloatingLocator())
    ]

    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual(keys.map((key) => JSON.stringify(JSON.parse(key))))
  })

  it('accepts the locator-specific 32 KiB boundary and rejects the next byte', () => {
    const overGenericIdLimit = `/${'a'.repeat(2 * 1024)}`
    const exactBoundary = `/${'b'.repeat(MAX_CANONICAL_PATH_BYTES - 1)}`
    const overBoundary = `${exactBoundary}c`

    expect(() =>
      assertTerminalAuthorityNamespaceLocator({
        kind: 'workspace',
        canonicalPath: overGenericIdLimit,
        pathFlavor: 'posix'
      })
    ).not.toThrow()
    expect(new TextEncoder().encode(exactBoundary)).toHaveLength(MAX_CANONICAL_PATH_BYTES)
    expect(() =>
      assertTerminalAuthorityNamespaceLocator({
        kind: 'workspace',
        canonicalPath: exactBoundary,
        pathFlavor: 'posix'
      })
    ).not.toThrow()
    expect(() =>
      assertTerminalAuthorityNamespaceLocator({
        kind: 'workspace',
        canonicalPath: overBoundary,
        pathFlavor: 'posix'
      })
    ).toThrow('invalid')
  })

  it('rejects cross-flavor roots, incomplete UNC paths, NUL, and multibyte overflow', () => {
    const invalid = [
      { canonicalPath: 'C:/repo', pathFlavor: 'posix' as const },
      { canonicalPath: '/srv/repo', pathFlavor: 'windows' as const },
      { canonicalPath: '//server', pathFlavor: 'windows' as const },
      { canonicalPath: '/srv/repo\0other', pathFlavor: 'posix' as const },
      {
        canonicalPath: `/${'é'.repeat(MAX_CANONICAL_PATH_BYTES / 2)}`,
        pathFlavor: 'posix' as const
      }
    ]

    for (const locator of invalid) {
      expect(() =>
        assertTerminalAuthorityNamespaceLocator({ kind: 'workspace', ...locator })
      ).toThrow()
    }
  })

  it('derives a stable namespace directory from the complete host and namespace tuple', () => {
    const namespace = { authorityHostId: 'host-a', namespaceId: 'namespace-a' }
    const expectedDigest = createHash('sha256')
      .update(namespace.authorityHostId, 'utf8')
      .update('\0')
      .update(namespace.namespaceId, 'utf8')
      .digest('hex')
    const expected = path.join('authority-root', 'namespaces', expectedDigest)

    expect(terminalSessionAuthorityNamespaceDirectory('authority-root', namespace)).toBe(expected)
    expect(terminalSessionAuthorityNamespaceDirectory('authority-root', namespace)).toBe(expected)
    expect(
      terminalSessionAuthorityNamespaceDirectory('authority-root', {
        authorityHostId: namespace.namespaceId,
        namespaceId: namespace.authorityHostId
      })
    ).not.toBe(expected)
  })
})
