import { createHash } from 'node:crypto'
import path from 'node:path'
import {
  assertAuthorityNamespace,
  type TerminalAuthorityNamespace
} from '../../shared/terminal-session-authority-identity'

export function terminalSessionAuthorityNamespaceDirectory(
  registryDirectory: string,
  namespace: TerminalAuthorityNamespace
): string {
  assertAuthorityNamespace(namespace)
  const digest = createHash('sha256')
    .update(namespace.authorityHostId, 'utf8')
    .update('\0')
    .update(namespace.namespaceId, 'utf8')
    .digest('hex')
  return path.join(registryDirectory, 'namespaces', digest)
}
