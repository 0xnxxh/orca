import { createHash } from 'node:crypto'
import {
  assertAuthorityId,
  type TerminalAuthorityNamespace
} from '../../shared/terminal-session-authority-identity'
import type { TerminalSessionAuthorityService } from './terminal-session-authority-service'

export type TerminalAuthorityAuthenticatedConsumerTransport = Readonly<{
  connectionGrantId: string
  principal: string
  capability: string
  token: object
}>

export function assertTerminalAuthorityHostId(authorityHostId: string): void {
  assertAuthorityId(authorityHostId, 'authorityHostId')
}

export function assertTerminalAuthorityConsumerTransport(
  transport: TerminalAuthorityAuthenticatedConsumerTransport
): void {
  assertAuthorityId(transport.connectionGrantId, 'connectionGrantId')
  assertAuthorityId(transport.principal, 'authenticated transport principal')
  assertAuthorityId(transport.capability, 'authenticated transport capability')
}

export function assertTerminalAuthorityAdmissionServiceNamespace(
  service: TerminalSessionAuthorityService,
  namespace: TerminalAuthorityNamespace
): void {
  if (
    service.namespace.authorityHostId !== namespace.authorityHostId ||
    service.namespace.namespaceId !== namespace.namespaceId
  ) {
    throw new Error('terminal authority namespace admission targets another namespace')
  }
}

export function assertTerminalAuthorityAdmissionTransportToken(
  expected: object,
  transport: TerminalAuthorityAuthenticatedConsumerTransport
): void {
  if (expected !== transport.token) {
    throw new Error('terminal authority namespace admission transport changed')
  }
}

export function assertExactTerminalAuthorityAdmissionRequest(
  expected: string,
  actual: string
): void {
  if (expected !== actual) {
    throw new Error('terminal authority namespace admission request changed')
  }
}

export function terminalAuthorityAdmissionRequestKey(
  namespace: TerminalAuthorityNamespace,
  requestId: string,
  transport: TerminalAuthorityAuthenticatedConsumerTransport
): string {
  return JSON.stringify([
    transport.connectionGrantId,
    namespace.authorityHostId,
    namespace.namespaceId,
    requestId
  ])
}

export function terminalAuthorityAdmissionChallengeScopeKey(
  transport: TerminalAuthorityAuthenticatedConsumerTransport
): string {
  return JSON.stringify([transport.principal, transport.capability])
}

export function terminalAuthorityAdmissionDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url')
}
