import { createHash } from 'node:crypto'
import { assertAuthorityId } from '../../shared/terminal-session-authority-identity'

export function terminalAuthorityLifecycleOperationId(
  callerOperationId: string,
  phase: string
): string {
  assertAuthorityId(callerOperationId, 'terminal lifecycle operationId')
  assertAuthorityId(phase, 'terminal lifecycle phase')
  return hashedOperationId('caller', [callerOperationId, phase])
}

export function terminalAuthorityLifecycleIdentityOperationId(
  phase: string,
  identities: readonly string[]
): string {
  assertAuthorityId(phase, 'terminal lifecycle phase')
  for (const identity of identities) {
    assertAuthorityId(identity, 'terminal lifecycle identity')
  }
  return hashedOperationId(phase, identities)
}

function hashedOperationId(scope: string, components: readonly string[]): string {
  const digest = createHash('sha256').update(JSON.stringify(components)).digest('hex')
  return `pty-lifecycle:${scope}:${digest}`
}
