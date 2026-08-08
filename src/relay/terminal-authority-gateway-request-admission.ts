import type { TerminalAuthorityRequestMethod } from '../shared/terminal-authority-routing'
import type { RequestContext } from './dispatcher'
import {
  AUTHORITY_EXACT_MUTATION_REQUESTS,
  EXACT_MUTATION_REQUESTS,
  LEGACY_MUTATION_REQUESTS,
  PREOPEN_MIGRATION_REQUESTS
} from './terminal-authority-gateway-rules'

export type TerminalAuthorityGatewayRequestAdmission = Readonly<{
  activeClientId: number | null
  pendingClientId: number | null
  activeClientHasAuthorityExactOperations: boolean
  unavailable: boolean
}>

export function assertTerminalAuthorityGatewayRequestAdmission(
  method: TerminalAuthorityRequestMethod,
  context: RequestContext,
  admission: TerminalAuthorityGatewayRequestAdmission
): void {
  if (admission.unavailable) {
    throw new Error('terminal_authority_gateway_unavailable')
  }
  if (method === 'pty.openClient') {
    assertAuthenticatedOwner(context)
    if (admission.pendingClientId !== null || admission.activeClientId !== null) {
      throw new Error('terminal_authority_client_already_admitted')
    }
    return
  }
  if (PREOPEN_MIGRATION_REQUESTS.has(method)) {
    assertAuthenticatedOwner(context)
    if (admission.pendingClientId !== null || admission.activeClientId !== null) {
      throw new Error('terminal_authority_client_already_admitted')
    }
    return
  }
  if (admission.activeClientId !== context.clientId) {
    throw new Error('terminal_authority_client_not_admitted')
  }
  if (LEGACY_MUTATION_REQUESTS.has(method)) {
    throw new Error('terminal_authority_legacy_mutation_rejected')
  }
  if (EXACT_MUTATION_REQUESTS.has(method)) {
    throw new Error('terminal_authority_incarnation_mutation_rejected')
  }
  if (
    AUTHORITY_EXACT_MUTATION_REQUESTS.has(method) &&
    !admission.activeClientHasAuthorityExactOperations
  ) {
    throw new Error('terminal_authority_exact_operations_not_granted')
  }
}

function assertAuthenticatedOwner(context: RequestContext): void {
  if (!context.sessionIdentity?.authenticated || !context.sessionIdentity.allowSessionOwner) {
    throw new Error('terminal_authority_client_not_authenticated')
  }
}
