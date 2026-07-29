import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import { isPtyIncarnationId } from '../../shared/pty-incarnation'
import type { PtySourceReceivingActivation } from '../../shared/pty-source-receiving-activation'
import type {
  SshPtyDataCallback,
  SshPtyExitCallback,
  SshPtyReplayCallback
} from './ssh-pty-provider-contract'
import { parseSshPtySourceFrame, type SshPtySourceFrame } from './ssh-pty-source-frame'

export type { SshPtyDataCallback, SshPtyExitCallback, SshPtyReplayCallback }

type SourceDeliveryState = Readonly<{
  activation: PtySourceReceivingActivation
  sourceEndSu: number
  revision: number
  provisional: boolean
}>

export type SshPtyReceivingActivationLease = Readonly<{
  commit: () => void
  rollback: () => void
}>

export type SshPtyNotificationSubscription = Readonly<{
  dispose: () => void
  installReceivingActivation: (
    relayPtyId: string,
    activation: PtySourceReceivingActivation
  ) => SshPtyReceivingActivationLease
}>

export function subscribeSshPtyNotifications(args: {
  mux: SshChannelMultiplexer
  toAppPtyId: (id: string) => string
  dataListeners: Set<SshPtyDataCallback>
  replayListeners: Set<SshPtyReplayCallback>
  exitListeners: Set<SshPtyExitCallback>
  livePtyIds: Set<string>
  recordExit: (relayPtyId: string, incarnationId: unknown) => void
  providerGeneration: number
  resolvePtyIncarnation: (relayPtyId: string, incarnationId?: unknown) => string
}): SshPtyNotificationSubscription {
  const sourceDeliveryByPty = new Map<string, SourceDeliveryState>()
  let nextSourceDeliveryRevision = 1
  const dispose = args.mux.onNotification((method, params) => {
    // Why: mux delivers every method to generic handlers; non-PTY payloads
    // (workspace.changed, fs.changed, …) have no `id` and must not reach
    // toAppPtyId → startsWith.
    if (method !== 'pty.exit' && method !== 'pty.data' && method !== 'pty.replay') {
      return
    }
    if (typeof params.id !== 'string' || params.id.length === 0) {
      return
    }
    const relayPtyId = params.id
    if (method === 'pty.exit') {
      const id = args.toAppPtyId(relayPtyId)
      const ptyIncarnation = args.resolvePtyIncarnation(relayPtyId, params.incarnationId)
      args.recordExit(relayPtyId, params.incarnationId)
      args.livePtyIds.delete(id)
      if (!sourceDeliveryByPty.get(relayPtyId)?.provisional) {
        sourceDeliveryByPty.delete(relayPtyId)
      }
      for (const listener of args.exitListeners) {
        listener({
          id,
          code: params.code as number,
          providerGeneration: args.providerGeneration,
          ptyIncarnation,
          ...(isPtyIncarnationId(params.incarnationId)
            ? { incarnationId: params.incarnationId }
            : {})
        })
      }
      return
    }
    if (method === 'pty.replay') {
      const id = args.toAppPtyId(relayPtyId)
      args.livePtyIds.add(id)
      for (const listener of args.replayListeners) {
        listener({ id, data: params.data as string })
      }
      return
    }
    const data = typeof params.data === 'string' ? params.data : ''
    const sourceFrame = parseSshPtySourceFrame(params, data, relayPtyId)
    if (
      sourceFrame.malformed ||
      (sourceFrame.source &&
        !acceptSourceDelivery(sourceDeliveryByPty, relayPtyId, params, sourceFrame.source))
    ) {
      cancelExactSourceDelivery(args.mux, relayPtyId, params)
      return
    }
    const id = args.toAppPtyId(relayPtyId)
    const ptyIncarnation = args.resolvePtyIncarnation(
      relayPtyId,
      params.ptyIncarnation ?? params.incarnationId
    )
    args.livePtyIds.add(id)
    for (const listener of args.dataListeners) {
      listener({
        id,
        data,
        providerGeneration: args.providerGeneration,
        ptyIncarnation: sourceFrame.source ? (params.ptyIncarnation as string) : ptyIncarnation,
        ...(typeof params.rawLength === 'number' ? { sequenceChars: params.rawLength } : {}),
        ...(params.transformed === true ? { transformed: true } : {}),
        ...(typeof params.seq === 'number' ? { seq: params.seq } : {}),
        ...(sourceFrame.source ? { source: sourceFrame.source } : {})
      })
    }
  })
  return Object.freeze({
    dispose,
    installReceivingActivation: (relayPtyId, activation) =>
      installReceivingActivation(
        args.mux,
        sourceDeliveryByPty,
        relayPtyId,
        activation,
        nextSourceDeliveryRevision++
      )
  })
}

function installReceivingActivation(
  mux: SshChannelMultiplexer,
  sourceDeliveryByPty: Map<string, SourceDeliveryState>,
  relayPtyId: string,
  activation: PtySourceReceivingActivation,
  revision: number
): SshPtyReceivingActivationLease {
  if (!relayPtyId || activation.ptyIncarnation.length === 0) {
    throw new Error('ssh_source_receiving_activation_invalid')
  }
  const previous = sourceDeliveryByPty.get(relayPtyId)
  if (previous && sameReceivingActivation(previous.activation, activation)) {
    if (previous.provisional) {
      throw new Error('ssh_source_receiving_activation_stale')
    }
    return settledReceivingActivationLease()
  }
  if (
    previous &&
    (activation.clientGeneration <= previous.activation.clientGeneration ||
      activation.ownerGeneration <= previous.activation.ownerGeneration ||
      activation.deliveryToken === previous.activation.deliveryToken)
  ) {
    throw new Error('ssh_source_receiving_activation_stale')
  }
  const installed = Object.freeze({
    activation,
    sourceEndSu: activation.checkpointSourceEndSu,
    revision,
    provisional: true
  })
  sourceDeliveryByPty.set(relayPtyId, installed)
  let settled = false
  return Object.freeze({
    commit: () => {
      if (settled) {
        return
      }
      settled = true
      const current = sourceDeliveryByPty.get(relayPtyId)
      if (current?.revision === revision) {
        sourceDeliveryByPty.set(relayPtyId, Object.freeze({ ...current, provisional: false }))
      }
    },
    rollback: () => {
      if (settled) {
        return
      }
      settled = true
      if (sourceDeliveryByPty.get(relayPtyId)?.revision === revision) {
        if (previous) {
          sourceDeliveryByPty.set(relayPtyId, previous)
        } else {
          sourceDeliveryByPty.delete(relayPtyId)
        }
      }
      cancelExactSourceDelivery(mux, relayPtyId, activation)
    }
  })
}

function settledReceivingActivationLease(): SshPtyReceivingActivationLease {
  return Object.freeze({ commit: () => {}, rollback: () => {} })
}

function sameReceivingActivation(
  left: PtySourceReceivingActivation,
  right: PtySourceReceivingActivation
): boolean {
  return (
    left.clientGeneration === right.clientGeneration &&
    left.ownerGeneration === right.ownerGeneration &&
    left.ptyIncarnation === right.ptyIncarnation &&
    left.deliveryToken === right.deliveryToken &&
    left.checkpointSourceEndSu === right.checkpointSourceEndSu &&
    left.recoveryEndSu === right.recoveryEndSu
  )
}

function acceptSourceDelivery(
  sourceDeliveryByPty: Map<string, SourceDeliveryState>,
  relayPtyId: string,
  params: Record<string, unknown>,
  source: SshPtySourceFrame
): boolean {
  const current = sourceDeliveryByPty.get(relayPtyId)
  if (
    !current ||
    current.activation.ptyIncarnation !== params.ptyIncarnation ||
    current.activation.deliveryToken !== source.deliveryToken ||
    current.activation.clientGeneration !== source.clientGeneration ||
    current.activation.ownerGeneration !== source.ownerGeneration ||
    current.sourceEndSu !== source.sourceStartSu
  ) {
    return false
  }
  sourceDeliveryByPty.set(
    relayPtyId,
    Object.freeze({ ...current, sourceEndSu: source.sourceEndSu })
  )
  return true
}

function cancelExactSourceDelivery(
  mux: SshChannelMultiplexer,
  relayPtyId: string,
  params: {
    deliveryToken?: unknown
    clientGeneration?: unknown
    ownerGeneration?: unknown
  }
): void {
  if (
    typeof params.deliveryToken !== 'string' ||
    params.deliveryToken.length === 0 ||
    !positiveSafeInteger(params.clientGeneration) ||
    !positiveSafeInteger(params.ownerGeneration)
  ) {
    return
  }
  try {
    void mux
      .request('pty.cancelDelivery', {
        id: relayPtyId,
        clientGeneration: params.clientGeneration,
        ownerGeneration: params.ownerGeneration,
        deliveryToken: params.deliveryToken
      })
      .catch(() => {})
  } catch {}
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}
