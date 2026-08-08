import type { PtySourceDeliveryIdentity, PtySourceSpan } from '../shared/pty-source-credit-contract'
import type {
  PtySourceRecoveryRequest,
  PtySourceRecoveryResult
} from '../shared/pty-source-recovery-contract'
import type { PtySourceReceivingActivation } from '../shared/pty-source-receiving-activation'
import type { RelayDispatcher, RequestContext } from './dispatcher'
import type { LegacyPtyProxySink } from './legacy-pty-proxy'
import type { PtySourceSendReservation } from './pty-source-credit-ledger'
import type { SshPtyConsumerSessionAdapter } from './ssh-pty-consumer-session-adapter'

export type LegacyPhysicalWorkerDownstreamAttachment = LegacyPtyProxySink &
  Readonly<{
    identity: PtySourceDeliveryIdentity
    sourceActivation: PtySourceReceivingActivation
    acknowledgedEndSu: () => number
    onCreditAvailable: () => void
    reopen: (
      input: Omit<LegacyPhysicalWorkerDownstreamOpenInput, 'checkpointSourceEndSu'>
    ) => LegacyPhysicalWorkerDownstreamOpenResult | null
    dispose: () => void
  }>

export type LegacyPhysicalWorkerDownstreamOpenInput = Readonly<{
  id: string
  incarnationId: string
  checkpointSourceEndSu: number
  sourceRecovery?: PtySourceRecoveryRequest
  durableDownstreamIdentity?: PtySourceDeliveryIdentity
  context: RequestContext | undefined
  onCapacity: () => void
}>

export type LegacyPhysicalWorkerDownstreamOpenResult =
  | Readonly<{
      status: 'attached'
      attachment: LegacyPhysicalWorkerDownstreamAttachment
      sourceRecovery?: PtySourceRecoveryResult
    }>
  | Readonly<{
      status: 'restore-required'
      sourceRecovery: Extract<PtySourceRecoveryResult, { status: 'restoreRequired' }>
    }>

export type LegacyPhysicalWorkerDownstreamDispatcher = Pick<
  RelayDispatcher,
  'onClientCapacity' | 'tryNotifyPtyDataToClient' | 'tryNotifyPtyExitToClient'
>

export type LegacyPhysicalWorkerDownstreamSession = Readonly<{
  openDelivery: (
    clientId: number,
    id: string,
    ptyIncarnation: string,
    checkpointSourceEndSu?: number
  ) => PtySourceDeliveryIdentity | null
  rotateDelivery: (
    oldIdentity: PtySourceDeliveryIdentity,
    newClientId: number,
    acceptedSourceEndSu: number
  ) => Readonly<{
    identity: PtySourceDeliveryIdentity
    recovery: readonly PtySourceSpan[]
  }>
  appendSource: SshPtyConsumerSessionAdapter['appendSource']
  reserveSourceSend: (
    identity: PtySourceDeliveryIdentity,
    maxSourceSu?: number
  ) => PtySourceSendReservation | null
  commitSourceSend: (reservation: PtySourceSendReservation) => void
  rollbackSourceSend: (reservation: PtySourceSendReservation) => void
  sealDelivery: (identity: PtySourceDeliveryIdentity) => void
  settleExitPublication: SshPtyConsumerSessionAdapter['settleExitPublication']
  sourceDeliverySnapshotIfKnown: SshPtyConsumerSessionAdapter['sourceDeliverySnapshotIfKnown']
  cancelDelivery: (identity: PtySourceDeliveryIdentity, reason: string) => void
}>
