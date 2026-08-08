import { createLegacyPhysicalWorkerDownstreamAttachment } from './legacy-physical-worker-downstream-attachment'
import type {
  LegacyPhysicalWorkerDownstreamDispatcher,
  LegacyPhysicalWorkerDownstreamOpenInput,
  LegacyPhysicalWorkerDownstreamOpenResult,
  LegacyPhysicalWorkerDownstreamSession
} from './legacy-physical-worker-downstream-contract'
import {
  pendingLegacyPhysicalWorkerRecovery,
  validateLegacyPhysicalWorkerDurableRecovery
} from './legacy-physical-worker-downstream-recovery'

export type {
  LegacyPhysicalWorkerDownstreamAttachment,
  LegacyPhysicalWorkerDownstreamOpenInput,
  LegacyPhysicalWorkerDownstreamOpenResult
} from './legacy-physical-worker-downstream-contract'

export class LegacyPhysicalWorkerDownstream {
  constructor(
    private readonly dispatcher: LegacyPhysicalWorkerDownstreamDispatcher,
    private readonly session: LegacyPhysicalWorkerDownstreamSession
  ) {}

  open(
    input: LegacyPhysicalWorkerDownstreamOpenInput
  ): LegacyPhysicalWorkerDownstreamOpenResult | null {
    if (!input.context?.onResponseSettled) {
      return null
    }
    const recovery = validateLegacyPhysicalWorkerDurableRecovery(input)
    if (recovery) {
      return recovery
    }
    const identity = this.session.openDelivery(
      input.context.clientId,
      input.id,
      input.incarnationId,
      input.checkpointSourceEndSu
    )
    if (!identity) {
      return null
    }
    const attachment = createLegacyPhysicalWorkerDownstreamAttachment({
      dispatcher: this.dispatcher,
      session: this.session,
      context: input.context,
      identity,
      checkpointSourceEndSu: input.checkpointSourceEndSu,
      recoveryEndSu: input.checkpointSourceEndSu,
      onCapacity: input.onCapacity
    })
    return Object.freeze({
      status: 'attached',
      attachment,
      ...(input.sourceRecovery
        ? {
            sourceRecovery: pendingLegacyPhysicalWorkerRecovery(attachment.sourceActivation)
          }
        : {})
    })
  }
}
