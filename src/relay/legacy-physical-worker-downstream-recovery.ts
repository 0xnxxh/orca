import type { PtySourceDeliveryIdentity } from '../shared/pty-source-credit-contract'
import type {
  PtySourceRecoveryRequest,
  PtySourceRecoveryResult
} from '../shared/pty-source-recovery-contract'
import type { PtySourceReceivingActivation } from '../shared/pty-source-receiving-activation'
import type {
  LegacyPhysicalWorkerDownstreamOpenInput,
  LegacyPhysicalWorkerDownstreamOpenResult
} from './legacy-physical-worker-downstream-contract'

export function validateLegacyPhysicalWorkerDurableRecovery(
  input: LegacyPhysicalWorkerDownstreamOpenInput
): Extract<LegacyPhysicalWorkerDownstreamOpenResult, { status: 'restore-required' }> | null {
  if (!input.sourceRecovery) {
    return input.checkpointSourceEndSu === 0
      ? null
      : legacyPhysicalWorkerRestoreRequired('deliveryUnavailable')
  }
  if (
    !input.durableDownstreamIdentity ||
    !legacyPhysicalWorkerRecoveryMatches(input.sourceRecovery, input.durableDownstreamIdentity) ||
    input.sourceRecovery.acceptedSourceEndSu !== input.checkpointSourceEndSu
  ) {
    return legacyPhysicalWorkerRestoreRequired('checkpointUnavailable')
  }
  return null
}

export function legacyPhysicalWorkerRecoveryMatches(
  recovery: PtySourceRecoveryRequest | undefined,
  identity: PtySourceDeliveryIdentity
): recovery is Extract<PtySourceRecoveryRequest, { status: 'checkpoint' }> {
  return (
    recovery?.status === 'checkpoint' &&
    recovery.clientGeneration === identity.clientGeneration &&
    recovery.ownerGeneration === identity.ownerGeneration &&
    recovery.ptyIncarnation === identity.ptyIncarnation &&
    recovery.deliveryToken === identity.deliveryToken
  )
}

export function pendingLegacyPhysicalWorkerRecovery(
  activation: PtySourceReceivingActivation
): Extract<PtySourceRecoveryResult, { status: 'pending' }> {
  return Object.freeze({ ...activation })
}

export function legacyPhysicalWorkerRestoreRequired(
  reason: string
): Extract<LegacyPhysicalWorkerDownstreamOpenResult, { status: 'restore-required' }> {
  return Object.freeze({
    status: 'restore-required',
    sourceRecovery: Object.freeze({ status: 'restoreRequired', reason })
  })
}
