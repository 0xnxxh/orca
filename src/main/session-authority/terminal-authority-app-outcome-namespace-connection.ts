import {
  parseTerminalAuthorityNamespaceAdmissionGrant,
  type TerminalAuthorityNamespaceAdmissionIntent
} from '../../shared/terminal-session-authority-consumer-proof'
import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import { sameTerminalAuthorityPolicyConsumer } from '../../shared/terminal-session-authority-consumer-transport'
import {
  TerminalAuthorityAppAdmissionIntentRequiredError,
  TerminalAuthorityAppAdmissionRejectedError,
  type TerminalAuthorityAppNamespaceAdmissionRequest,
  type TerminalAuthorityAppOutcomeHostConnection,
  type TerminalAuthorityAppOutcomeNamespaceConnection
} from './terminal-authority-app-outcome-host-contract'
import type { TerminalAuthorityAppNamespaceGeneration } from './terminal-authority-app-outcome-namespace-state'
import type { TerminalAuthorityPolicyOutcomeTransport } from './terminal-session-authority-policy-consumers'

export type TerminalAuthorityAppAdmissionAttempt = {
  readonly host: TerminalAuthorityAppOutcomeHostConnection
  request: TerminalAuthorityAppNamespaceAdmissionRequest
  opening: Promise<TerminalAuthorityAppOutcomeNamespaceConnection> | null
  openingTimedOut: boolean
  isCurrent: () => boolean
}

type TerminalAuthorityAppNamespaceConnectionOptions = Readonly<{
  admission: TerminalAuthorityAppAdmissionAttempt
  state: TerminalAuthorityAppNamespaceGeneration
  timeoutMs: number
  transport: TerminalAuthorityPolicyOutcomeTransport
  isCurrent: () => boolean
  createId: () => string
}>

export function createTerminalAuthorityAppAdmissionAttempt(
  host: TerminalAuthorityAppOutcomeHostConnection,
  processIncarnationId: string,
  namespace: TerminalAuthorityNamespace,
  createId: () => string,
  intent: TerminalAuthorityNamespaceAdmissionIntent = 'resume'
): TerminalAuthorityAppAdmissionAttempt {
  return {
    host,
    request: admissionRequest(processIncarnationId, namespace, createId, intent),
    opening: null,
    openingTimedOut: false,
    isCurrent: () => false
  }
}

export async function connectTerminalAuthorityAppOutcomeNamespace(
  options: TerminalAuthorityAppNamespaceConnectionOptions
): Promise<void> {
  const attemptedIntents = new Set<TerminalAuthorityNamespaceAdmissionIntent>()
  while (true) {
    attemptedIntents.add(options.admission.request.intent)
    try {
      await openTerminalAuthorityAppOutcomeNamespace(options)
      return
    } catch (error) {
      if (
        error instanceof TerminalAuthorityAppAdmissionIntentRequiredError &&
        !attemptedIntents.has(error.requiredIntent)
      ) {
        options.admission.request = admissionRequest(
          options.admission.request.candidateProcessIncarnationId,
          options.admission.request.namespace,
          options.createId,
          error.requiredIntent
        )
        options.admission.opening = null
        options.admission.openingTimedOut = false
        continue
      }
      throw error
    }
  }
}

async function openTerminalAuthorityAppOutcomeNamespace(
  options: TerminalAuthorityAppNamespaceConnectionOptions
): Promise<void> {
  options.admission.isCurrent = options.isCurrent
  let pending = options.admission.opening
  if (!pending) {
    pending = options.admission.host.openNamespace(
      options.admission.request,
      options.transport,
      (connection) => {
        if (!options.isCurrent()) {
          connection.disconnect()
          return
        }
        options.state.connection = connection
      }
    )
    options.admission.opening = pending
    options.admission.openingTimedOut = false
    observePendingConnection(options.admission, pending)
  }
  let connection: TerminalAuthorityAppOutcomeNamespaceConnection
  try {
    connection = options.admission.openingTimedOut
      ? await options.state.work.waitForPending(pending)
      : await options.state.work.settle(pending, options.timeoutMs, 'connection')
  } catch (error) {
    if (options.admission.opening === pending) {
      options.admission.openingTimedOut = true
    }
    throw error
  }
  if (options.admission.opening === pending) {
    options.admission.opening = null
    options.admission.openingTimedOut = false
  }
  try {
    assertCurrent(options)
  } catch (error) {
    connection.disconnect()
    throw error
  }
  assertConnection(connection, options.admission.request)
  if (options.state.connection && options.state.connection !== connection) {
    connection.disconnect()
    throw new Error('terminal authority app outcome opening connection changed')
  }
  options.state.connection = connection
  await options.state.work.settle(
    Promise.resolve(connection.activate?.()),
    options.timeoutMs,
    'activation'
  )
  assertCurrent(options)
}

function observePendingConnection(
  admission: TerminalAuthorityAppAdmissionAttempt,
  pending: Promise<TerminalAuthorityAppOutcomeNamespaceConnection>
): void {
  void pending.then(
    (connection) => {
      if (!admission.isCurrent()) {
        connection.disconnect()
        clearPendingConnection(admission, pending)
      }
    },
    () => clearPendingConnection(admission, pending)
  )
}

function clearPendingConnection(
  admission: TerminalAuthorityAppAdmissionAttempt,
  pending: Promise<TerminalAuthorityAppOutcomeNamespaceConnection>
): void {
  if (admission.opening === pending) {
    admission.opening = null
    admission.openingTimedOut = false
  }
}

function admissionRequest(
  processIncarnationId: string,
  namespace: TerminalAuthorityNamespace,
  createId: () => string,
  intent: TerminalAuthorityNamespaceAdmissionIntent
): TerminalAuthorityAppNamespaceAdmissionRequest {
  return Object.freeze({
    namespace: Object.freeze({ ...namespace }),
    candidateProcessIncarnationId: processIncarnationId,
    candidateSessionNonce: `app-session:${createId()}`,
    requestId: `app-request:${createId()}`,
    intent
  })
}

function assertConnection(
  connection: TerminalAuthorityAppOutcomeNamespaceConnection,
  request: TerminalAuthorityAppNamespaceAdmissionRequest
): void {
  const grant = parseTerminalAuthorityNamespaceAdmissionGrant(connection.grant)
  if (
    !grant ||
    !sameTerminalAuthorityPolicyConsumer(grant.consumer, connection.expectedConsumer) ||
    grant.consumer.consumerIncarnationId !== request.candidateProcessIncarnationId ||
    !sameNamespace(grant.namespace, request.namespace) ||
    grant.requestId !== request.requestId
  ) {
    connection.disconnect()
    throw new TerminalAuthorityAppAdmissionRejectedError(
      'terminal authority app outcome host returned the wrong admission grant'
    )
  }
}

function sameNamespace(
  left: TerminalAuthorityNamespace | undefined,
  right: TerminalAuthorityNamespace
): boolean {
  return left?.authorityHostId === right.authorityHostId && left.namespaceId === right.namespaceId
}

function assertCurrent(options: TerminalAuthorityAppNamespaceConnectionOptions): void {
  if (!options.isCurrent()) {
    throw new Error('terminal authority app outcome callback is stale')
  }
}
