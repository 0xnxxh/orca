const MAX_CANONICAL_WORKSPACE_PATH_BYTES = 32 * 1024

export type TerminalAuthorityPathFlavor = 'posix' | 'windows'

export type TerminalAuthorityNamespaceLocator =
  | Readonly<{
      kind: 'workspace'
      canonicalPath: string
      pathFlavor: TerminalAuthorityPathFlavor
    }>
  | Readonly<{ kind: 'floating' }>

export function assertTerminalAuthorityNamespaceLocator(
  locator: TerminalAuthorityNamespaceLocator
): void {
  if (locator.kind === 'floating') {
    return
  }
  if (locator.kind !== 'workspace') {
    throw new Error('terminal authority locator kind is invalid')
  }
  if (
    typeof locator.canonicalPath !== 'string' ||
    locator.canonicalPath.length === 0 ||
    new TextEncoder().encode(locator.canonicalPath).byteLength >
      MAX_CANONICAL_WORKSPACE_PATH_BYTES ||
    locator.canonicalPath.includes('\0') ||
    locator.canonicalPath.includes('\r') ||
    locator.canonicalPath.includes('\n')
  ) {
    throw new Error('canonical workspace path is invalid')
  }
  if (locator.pathFlavor === 'posix') {
    if (!locator.canonicalPath.startsWith('/')) {
      throw new Error('canonical POSIX workspace path must be absolute')
    }
    return
  }
  if (
    locator.pathFlavor !== 'windows' ||
    !(
      /^[A-Za-z]:\//.test(locator.canonicalPath) ||
      /^\/\/[^/]+\/[^/]+(?:\/|$)/.test(locator.canonicalPath)
    )
  ) {
    throw new Error('canonical Windows workspace path must be absolute')
  }
}

export function terminalAuthorityNamespaceLocatorKey(
  locator: TerminalAuthorityNamespaceLocator
): string {
  assertTerminalAuthorityNamespaceLocator(locator)
  return locator.kind === 'floating'
    ? '["floating"]'
    : JSON.stringify(['workspace', locator.pathFlavor, locator.canonicalPath])
}
