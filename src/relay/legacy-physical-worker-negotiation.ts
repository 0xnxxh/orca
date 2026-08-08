import {
  PTY_CONSUMER_SESSION_PROTOCOL_VERSION,
  type PtyConsumerSessionGrant
} from '../shared/pty-consumer-session'
import { PTY_EXACT_OPERATION_PROTOCOL_VERSION } from '../shared/pty-exact-operation-protocol'

export type LegacyPhysicalWorkerCapabilities = Readonly<{
  consumerSessionVersion: 1
  outputFlowControlVersion: 1
  exactOperationsVersion: 1 | null
  heldProducerPauseVersion: 1
  mutationMode: 'exact-v1' | 'legacy-fenced-v1'
  sourceWindowSu: number
}>

export function validateLegacyPhysicalWorkerGrant(
  value: unknown,
  input: Readonly<{ expectedBuildId: string; requestedSourceWindowSu: number }>
):
  | Readonly<{
      grant: Readonly<PtyConsumerSessionGrant>
      capabilities: LegacyPhysicalWorkerCapabilities
    }>
  | Readonly<{ reason: string }> {
  if (typeof value !== 'object' || value === null) {
    return { reason: 'invalid-open-client-grant' }
  }
  const grant = value as Partial<PtyConsumerSessionGrant>
  const flow = grant.capabilities?.outputFlowControl
  const exact = grant.capabilities?.exactOperations
  const heldPause = grant.capabilities?.heldProducerPause
  if (
    grant.protocolVersion !== PTY_CONSUMER_SESSION_PROTOCOL_VERSION ||
    grant.serverBuildId !== input.expectedBuildId ||
    grant.role !== 'session-owner' ||
    !positiveInteger(grant.clientGeneration) ||
    !positiveInteger(grant.ownerGeneration) ||
    typeof grant.ownerLease !== 'string' ||
    !grant.ownerLease ||
    flow?.version !== 1 ||
    heldPause?.version !== 1 ||
    !positiveInteger(flow.windowSu) ||
    flow.windowSu > input.requestedSourceWindowSu ||
    (exact !== undefined && exact.version !== PTY_EXACT_OPERATION_PROTOCOL_VERSION)
  ) {
    return { reason: 'required-worker-capabilities-not-granted' }
  }
  return Object.freeze({
    grant: grant as Readonly<PtyConsumerSessionGrant>,
    capabilities: Object.freeze({
      consumerSessionVersion: 1,
      outputFlowControlVersion: 1,
      exactOperationsVersion: exact?.version === PTY_EXACT_OPERATION_PROTOCOL_VERSION ? 1 : null,
      heldProducerPauseVersion: 1,
      mutationMode:
        exact?.version === PTY_EXACT_OPERATION_PROTOCOL_VERSION ? 'exact-v1' : 'legacy-fenced-v1',
      sourceWindowSu: flow.windowSu
    })
  })
}

export function isLegacyPhysicalWorkerOpenUnsupported(error: unknown): boolean {
  return (
    legacyPhysicalWorkerMethodMissing(error) ||
    (error instanceof Error && /method not found|unsupported pty\.openClient/i.test(error.message))
  )
}

export function legacyPhysicalWorkerMethodMissing(error: unknown): boolean {
  return (
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === -32601) ||
    (error instanceof Error && /method not found/i.test(error.message))
  )
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}
