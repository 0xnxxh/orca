import {
  PTY_CONSUMER_SESSION_PROTOCOL_VERSION,
  type PtyConsumerSessionGrant
} from '../shared/pty-consumer-session'
import type { PtySourceCreditAck } from '../shared/pty-source-credit-contract'
import type { PtySourceRecoveryRequest } from '../shared/pty-source-recovery-contract'
import { PTY_EXACT_OPERATION_PROTOCOL_VERSION } from '../shared/pty-exact-operation-protocol'
import type { LegacyRelayStatusSample } from './legacy-relay-broker-connection-proof'
import { parseLegacyPhysicalWorkerCutoverStatus } from './legacy-physical-worker-cutover-status'
import {
  parseLegacyPhysicalWorkerPty,
  type LegacyPhysicalWorkerPty
} from './legacy-physical-worker-inventory'
import {
  isLegacyPhysicalWorkerOpenUnsupported,
  validateLegacyPhysicalWorkerGrant,
  type LegacyPhysicalWorkerCapabilities
} from './legacy-physical-worker-negotiation'
import {
  dispatchVerifiedLegacyPhysicalWorkerMutation,
  type LegacyPhysicalWorkerMutation,
  type LegacyPhysicalWorkerPtyIdentity
} from './legacy-physical-worker-mutation'
import { LegacyPhysicalWorkerClientExactOperations } from './legacy-physical-worker-client-exact-operations'
import { publishLegacyPhysicalWorkerSourceAcknowledgement } from './legacy-physical-worker-client-source-settlement'
import { prepareLegacyPhysicalWorkerCutoverGrace } from './legacy-physical-worker-cutover-grace'

const MAX_LEGACY_WORKER_PTYS = 50

export type LegacyPhysicalWorkerRpc = Readonly<{
  request: (method: string, params?: Record<string, unknown>) => Promise<unknown>
  notify: (method: string, params: Record<string, unknown>) => void
  notifyWithSettlement?: (
    method: string,
    params: Record<string, unknown>,
    onSettled: (result: Readonly<{ ok: true }> | Readonly<{ ok: false; error: Error }>) => void
  ) => void
  onNotification: (
    listener: (method: string, params: Record<string, unknown>) => void
  ) => () => void
  isOpen: () => boolean
  onClose: (listener: () => void) => () => void
  close: () => void
}>

export type { LegacyPhysicalWorkerPty } from './legacy-physical-worker-inventory'

export type { LegacyPhysicalWorkerCapabilities } from './legacy-physical-worker-negotiation'

export type LegacyPhysicalWorkerOpenResult =
  | Readonly<{ status: 'supported'; client: LegacyPhysicalWorkerClient }>
  | Readonly<{ status: 'unsupported'; reason: string }>

export type {
  LegacyPhysicalWorkerMutation,
  LegacyPhysicalWorkerPtyIdentity
} from './legacy-physical-worker-mutation'

export async function openLegacyPhysicalWorker(input: {
  rpc: LegacyPhysicalWorkerRpc
  clientInstanceId: string
  expectedBuildId: string
  requestedSourceWindowSu: number
  resume?: Readonly<{ ownerGeneration: number; ownerLease: string }>
}): Promise<LegacyPhysicalWorkerOpenResult> {
  if (!input.rpc.isOpen()) {
    return Object.freeze({ status: 'unsupported', reason: 'worker-connection-closed' })
  }
  if (!input.rpc.notifyWithSettlement) {
    return Object.freeze({ status: 'unsupported', reason: 'source-credit-settlement-unsupported' })
  }
  let result: unknown
  try {
    result = await input.rpc.request('pty.openClient', {
      protocolVersion: PTY_CONSUMER_SESSION_PROTOCOL_VERSION,
      clientInstanceId: input.clientInstanceId,
      requestedRole: 'session-owner',
      ...(input.resume ? { resume: input.resume } : {}),
      capabilities: {
        outputFlowControl: {
          versions: [1],
          requestedWindowSu: input.requestedSourceWindowSu
        },
        exactOperations: { versions: [PTY_EXACT_OPERATION_PROTOCOL_VERSION] },
        heldProducerPause: { versions: [1] }
      }
    })
  } catch (error) {
    if (isLegacyPhysicalWorkerOpenUnsupported(error)) {
      return Object.freeze({ status: 'unsupported', reason: 'pty.openClient-unsupported' })
    }
    throw error
  }
  const grant = validateLegacyPhysicalWorkerGrant(result, input)
  if ('reason' in grant) {
    return Object.freeze({ status: 'unsupported', reason: grant.reason })
  }
  return Object.freeze({
    status: 'supported',
    client: new LegacyPhysicalWorkerClient(
      input.rpc,
      grant.grant,
      grant.capabilities,
      input.clientInstanceId
    )
  })
}

export class LegacyPhysicalWorkerClient {
  readonly ownerGeneration: number
  readonly ownerLease: string
  readonly serverBuildId: string
  readonly brokerConnectionIdentity: string
  private cutoverGraceAcknowledged = false
  private readonly exactOperations: LegacyPhysicalWorkerClientExactOperations

  constructor(
    private readonly rpc: LegacyPhysicalWorkerRpc,
    grant: Readonly<PtyConsumerSessionGrant>,
    readonly capabilities: LegacyPhysicalWorkerCapabilities,
    clientInstanceId = 'legacy-broker'
  ) {
    this.ownerGeneration = grant.ownerGeneration!
    this.ownerLease = grant.ownerLease!
    this.serverBuildId = grant.serverBuildId
    this.brokerConnectionIdentity = `${clientInstanceId}:${grant.clientGeneration}:${grant.ownerGeneration}`
    this.exactOperations = new LegacyPhysicalWorkerClientExactOperations(
      rpc,
      capabilities.mutationMode
    )
  }

  isOpen(): boolean {
    return this.rpc.isOpen()
  }

  onClose(listener: () => void): () => void {
    return this.rpc.onClose(listener)
  }

  onNotification(listener: (method: string, params: Record<string, unknown>) => void): () => void {
    return this.rpc.onNotification(listener)
  }

  close(): void {
    this.rpc.close()
  }

  async prepareCutoverGrace(): Promise<
    Readonly<{ status: 'ready' }> | Readonly<{ status: 'unsupported'; reason: string }>
  > {
    return await prepareLegacyPhysicalWorkerCutoverGrace(this.rpc, () => {
      this.cutoverGraceAcknowledged = true
    })
  }

  async sampleCutoverStatus(): Promise<LegacyRelayStatusSample> {
    if (!this.cutoverGraceAcknowledged) {
      throw new Error('legacy physical worker zero grace was not acknowledged')
    }
    return parseLegacyPhysicalWorkerCutoverStatus(
      await this.rpc.request('relay.status'),
      this.brokerConnectionIdentity
    )
  }

  async listPtys(): Promise<LegacyPhysicalWorkerPty[]> {
    const result = await this.rpc.request('pty.listProcesses')
    if (!Array.isArray(result) || result.length > MAX_LEGACY_WORKER_PTYS) {
      throw new Error('legacy physical worker returned an invalid bounded PTY inventory')
    }
    return result.map(parseLegacyPhysicalWorkerPty)
  }

  async attach(
    pty: Pick<LegacyPhysicalWorkerPty, 'id' | 'incarnationId'> &
      Readonly<{ expectedPaneKey?: string; expectedTabId?: string }>,
    sourceRecovery?: PtySourceRecoveryRequest
  ): Promise<Record<string, unknown>> {
    const result = await this.rpc.request('pty.attach', {
      id: pty.id,
      expectedIncarnationId: pty.incarnationId,
      expectedPtyIncarnationId: pty.incarnationId,
      ...(pty.expectedPaneKey ? { expectedPaneKey: pty.expectedPaneKey } : {}),
      ...(pty.expectedTabId ? { expectedTabId: pty.expectedTabId } : {}),
      ...(sourceRecovery ? { sourceRecovery } : {}),
      suppressReplayNotification: true
    })
    if (typeof result !== 'object' || result === null) {
      throw new Error('legacy physical worker returned an invalid attach result')
    }
    const record = result as Record<string, unknown>
    if (record.incarnationId !== pty.incarnationId) {
      throw new Error('legacy physical worker PTY incarnation changed during attach')
    }
    return record
  }

  write(id: string, incarnationId: string, data: string): void {
    this.exactOperations.write(id, incarnationId, data)
  }

  resize(id: string, incarnationId: string, cols: number, rows: number): void {
    this.exactOperations.resize(id, incarnationId, cols, rows)
  }

  async signal(id: string, incarnationId: string, signal: string): Promise<boolean> {
    return await this.exactOperations.signal(id, incarnationId, signal)
  }

  async clear(id: string, incarnationId: string): Promise<boolean> {
    return await this.exactOperations.clear(id, incarnationId)
  }

  async shutdown(id: string, incarnationId: string, immediate = false): Promise<boolean> {
    return await this.exactOperations.shutdown(id, incarnationId, immediate)
  }

  async dispatchVerifiedMutation(
    pty: LegacyPhysicalWorkerPtyIdentity,
    mutation: LegacyPhysicalWorkerMutation
  ): Promise<boolean> {
    return await dispatchVerifiedLegacyPhysicalWorkerMutation(
      this.rpc,
      this.capabilities.mutationMode,
      pty,
      mutation
    )
  }

  acknowledgeSource(acknowledgements: readonly PtySourceCreditAck[]): void {
    this.rpc.notify('pty.ackData', { acknowledgements })
  }

  publishSourceAcknowledgement(
    acknowledgement: PtySourceCreditAck,
    acknowledgementId: string
  ): Promise<void> {
    return publishLegacyPhysicalWorkerSourceAcknowledgement(
      this.rpc,
      acknowledgement,
      acknowledgementId
    )
  }

  setDeliveryPaused(identity: {
    id: string
    clientGeneration: number
    ownerGeneration: number
    deliveryToken: string
    paused: boolean
  }): void {
    this.rpc.notify('pty.setDeliveryPaused', identity)
  }

  async setHeldProducerPause(identity: {
    id: string
    clientGeneration: number
    ownerGeneration: number
    ptyIncarnationId: string
    heldPauseToken: string
    paused: boolean
  }): Promise<boolean> {
    return await this.exactOperations.setHeldProducerPause(identity)
  }
}
