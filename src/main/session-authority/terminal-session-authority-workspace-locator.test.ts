import { describe, expect, it } from 'vitest'
import {
  terminalAuthorityFloatingLocator,
  terminalAuthorityWorkspaceLocator
} from './terminal-session-authority-workspace-locator'

describe('terminal authority workspace locator', () => {
  it('uses the authority host realpath for worktrees and folders', () => {
    const locator = terminalAuthorityWorkspaceLocator('/ssh-alias/repo-link', {
      pathFlavor: 'posix',
      realpath: () => '/srv/account/repo',
      isDirectory: () => true
    })
    expect(locator).toEqual({
      kind: 'workspace',
      canonicalPath: '/srv/account/repo',
      pathFlavor: 'posix'
    })
  })

  it('normalizes remote Windows device and UNC paths without case folding', () => {
    expect(
      terminalAuthorityWorkspaceLocator('C:\\Users\\Alice\\repo', {
        pathFlavor: 'windows',
        realpath: () => '\\\\?\\C:\\Users\\Alice\\repo\\',
        isDirectory: () => true
      })
    ).toEqual({
      kind: 'workspace',
      canonicalPath: 'C:/Users/Alice/repo',
      pathFlavor: 'windows'
    })
    expect(
      terminalAuthorityWorkspaceLocator('\\\\server\\share\\repo', {
        pathFlavor: 'windows',
        realpath: () => '\\\\?\\UNC\\Server\\Share\\repo',
        isDirectory: () => true
      })
    ).toEqual({
      kind: 'workspace',
      canonicalPath: '//Server/Share/repo',
      pathFlavor: 'windows'
    })
  })

  it('fails closed for relative paths and non-directories', () => {
    expect(() =>
      terminalAuthorityWorkspaceLocator('relative/repo', {
        pathFlavor: 'posix',
        realpath: (value) => value,
        isDirectory: () => true
      })
    ).toThrow('absolute')
    expect(() =>
      terminalAuthorityWorkspaceLocator('/srv/file', {
        pathFlavor: 'posix',
        realpath: (value) => value,
        isDirectory: () => false
      })
    ).toThrow('not a directory')
  })

  it('uses one explicit host-scoped floating locator', () => {
    expect(terminalAuthorityFloatingLocator()).toEqual({ kind: 'floating' })
  })
})
