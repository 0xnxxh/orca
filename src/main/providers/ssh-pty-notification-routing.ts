import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import { isPtyIncarnationId } from '../../shared/pty-incarnation'
import type {
  SshPtyDataCallback,
  SshPtyExitCallback,
  SshPtyReplayCallback
} from './ssh-pty-provider-contract'
import { parseSshPtySourceFrame, type SshPtySourceFrame } from './ssh-pty-source-frame'

export type { SshPtyDataCallback, SshPtyExitCallback, SshPtyReplayCallback }

type SourceDeliveryState = Readonly<{
  clientGeneration: number
  ownerGeneration: number
  ptyIncarnation: string
  deliveryToken: string
  sourceEndSu: number
}>

type SourceDeliveryOrder = 'continuation' | 'rotation' | 'invalid'

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
}): () => void {
  const sourceDeliveryByPty = new Map<string, SourceDeliveryState>()
  return args.mux.onNotification((method, params) => {
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
      sourceDeliveryByPty.delete(relayPtyId)
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
}

function acceptSourceDelivery(
  sourceDeliveryByPty: Map<string, SourceDeliveryState>,
  relayPtyId: string,
  params: Record<string, unknown>,
  source: SshPtySourceFrame
): boolean {
  const ptyIncarnation = params.ptyIncarnation as string
  const current = sourceDeliveryByPty.get(relayPtyId)
  if (current) {
    const order = sourceDeliveryOrder(current, source)
    const incarnationMatches = current.ptyIncarnation === ptyIncarnation
    if (!incarnationMatches || order === 'invalid') {
      return false
    }
    if (
      order === 'continuation' &&
      (current.deliveryToken !== source.deliveryToken ||
        current.sourceEndSu !== source.sourceStartSu)
    ) {
      return false
    }
    if (order === 'rotation' && current.deliveryToken === source.deliveryToken) {
      return false
    }
  }
  sourceDeliveryByPty.set(
    relayPtyId,
    Object.freeze({
      clientGeneration: source.clientGeneration,
      ownerGeneration: source.ownerGeneration,
      ptyIncarnation,
      deliveryToken: source.deliveryToken,
      sourceEndSu: source.sourceEndSu
    })
  )
  return true
}

function sourceDeliveryOrder(
  current: SourceDeliveryState,
  source: SshPtySourceFrame
): SourceDeliveryOrder {
  if (
    source.clientGeneration === current.clientGeneration &&
    source.ownerGeneration === current.ownerGeneration
  ) {
    return 'continuation'
  }
  if (
    source.clientGeneration > current.clientGeneration &&
    source.ownerGeneration > current.ownerGeneration
  ) {
    return 'rotation'
  }
  return 'invalid'
}

function cancelExactSourceDelivery(
  mux: SshChannelMultiplexer,
  relayPtyId: string,
  params: Record<string, unknown>
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
