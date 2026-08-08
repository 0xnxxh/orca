import { realpathSync, statSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import {
  assertTerminalAuthorityNamespaceLocator,
  type TerminalAuthorityNamespaceLocator,
  type TerminalAuthorityPathFlavor
} from '../../shared/terminal-session-authority-locator'

type TerminalAuthorityWorkspaceLocatorOptions = Readonly<{
  pathFlavor?: TerminalAuthorityPathFlavor
  realpath?: (path: string) => string
  isDirectory?: (path: string) => boolean
}>

export function terminalAuthorityWorkspaceLocator(
  workspacePath: string,
  options: TerminalAuthorityWorkspaceLocatorOptions = {}
): TerminalAuthorityNamespaceLocator {
  const pathFlavor = options.pathFlavor ?? (process.platform === 'win32' ? 'windows' : 'posix')
  assertAbsoluteWorkspacePath(workspacePath, pathFlavor)
  const realpath = options.realpath ?? realpathSync.native
  const canonicalPath = normalizeCanonicalWorkspacePath(realpath(workspacePath), pathFlavor)
  const isDirectory = options.isDirectory ?? ((path: string) => statSync(path).isDirectory())
  if (!isDirectory(canonicalPath)) {
    throw new Error('terminal authority workspace path is not a directory')
  }
  const locator = Object.freeze({ kind: 'workspace', canonicalPath, pathFlavor } as const)
  assertTerminalAuthorityNamespaceLocator(locator)
  return locator
}

export function terminalAuthorityFloatingLocator(): TerminalAuthorityNamespaceLocator {
  return Object.freeze({ kind: 'floating' })
}

function assertAbsoluteWorkspacePath(
  workspacePath: string,
  pathFlavor: TerminalAuthorityPathFlavor
): void {
  const absolute =
    pathFlavor === 'windows'
      ? win32.isAbsolute(workspacePath) && !/^[\\/][^\\/]/.test(workspacePath)
      : posix.isAbsolute(workspacePath)
  if (!absolute) {
    throw new Error('terminal authority workspace path must be absolute')
  }
}

function normalizeCanonicalWorkspacePath(
  canonicalPath: string,
  pathFlavor: TerminalAuthorityPathFlavor
): string {
  if (pathFlavor === 'posix') {
    return trimTrailingSeparators(posix.normalize(canonicalPath), '/')
  }
  const withoutDevicePrefix = canonicalPath
    .replace(/^\\\\\?\\UNC\\/i, '\\\\')
    .replace(/^\\\\\?\\/, '')
  return trimTrailingSeparators(win32.normalize(withoutDevicePrefix).replace(/\\/g, '/'), '/')
}

function trimTrailingSeparators(value: string, separator: string): string {
  if (value === '/' || /^[A-Za-z]:\/$/.test(value) || /^\/\/[^/]+\/[^/]+\/$/.test(value)) {
    return value
  }
  return value.replace(new RegExp(`${separator}+$`), '')
}
