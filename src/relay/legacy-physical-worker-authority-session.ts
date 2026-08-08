import type { TerminalSessionBinding } from '../shared/terminal-session-authority-identity'
import type {
  LegacyPhysicalWorkerAttachRequest,
  LegacyPhysicalWorkerAttachResult
} from './legacy-physical-worker-attach-router'
import type { LegacyPhysicalWorkerClient } from './legacy-physical-worker-client'
import type { LegacyPhysicalWorkerExactRoute } from './legacy-physical-worker-exact-route'
import type {
  LegacyPhysicalWorkerDownstream,
  LegacyPhysicalWorkerDownstreamAttachment
} from './legacy-physical-worker-downstream'
import type {
  LegacyPtyProxyCheckpointStore,
  LegacyPtyProxyCursorCheckpoint
} from './legacy-pty-proxy-cursor'
import type { LegacyPtyProxyCursorRepository } from './legacy-pty-proxy-cursor-repository'
import type { OrderedLegacyPtyProxy } from './legacy-pty-proxy'
import type { parseLegacyPhysicalWorkerActivation } from './legacy-physical-worker-source-event'
import type { LegacyPhysicalWorkerMutation } from './legacy-physical-worker-mutation'

export type ImportedPhysicalWorkerPtySession = {
  binding: TerminalSessionBinding
  client: LegacyPhysicalWorkerClient
  route: LegacyPhysicalWorkerExactRoute
  upstreamIdentity: ReturnType<typeof parseLegacyPhysicalWorkerActivation>
  downstream: LegacyPhysicalWorkerDownstreamAttachment
  proxy: OrderedLegacyPtyProxy
  cursorStore: LegacyPtyProxyCheckpointStore
  ackTask: Promise<void> | null
  requestedAckEndSu: number
  mutationTail: Promise<void>
  exitRecorded: boolean
  exitRecording: boolean
  pendingExitCode: number | null
  upstreamExited: boolean
  retired: boolean
  downstreamRotating: boolean
  attachRequest: LegacyPhysicalWorkerAttachRequest
}

export type LegacyPhysicalWorkerAuthorityRouterOptions = Readonly<{
  registry: Readonly<{
    resolveExactPtyRoute: (
      ownerIncarnationId: string,
      pty: Readonly<{ id: string; incarnationId: string }>
    ) => Promise<LegacyPhysicalWorkerExactRoute | null>
    dispatchPtyMutation: (
      ownerIncarnationId: string,
      pty: Readonly<{ id: string; incarnationId: string }>,
      mutation: LegacyPhysicalWorkerMutation
    ) => Promise<boolean>
    reservesPhysicalPtyId: (id: string) => boolean
  }>
  downstream: Pick<LegacyPhysicalWorkerDownstream, 'open'>
  cursors: LegacyPtyProxyCursorRepository
  maxSessions?: number
  onExitSettled?: (request: LegacyPhysicalWorkerAttachRequest, code: number) => Promise<void>
  recordExit?: (request: LegacyPhysicalWorkerAttachRequest, code: number) => Promise<void>
  onWorkerFault?: (error: Error) => void
}>

export function sameImportedPhysicalWorkerBinding(
  left: TerminalSessionBinding,
  right: TerminalSessionBinding
): boolean {
  return (
    left.ownerIncarnationId === right.ownerIncarnationId &&
    left.physicalPtyId === right.physicalPtyId &&
    left.ptyIncarnationId === right.ptyIncarnationId
  )
}

export function importedPhysicalWorkerBindingKey(binding: TerminalSessionBinding): string {
  return JSON.stringify([
    binding.ownerIncarnationId,
    binding.physicalPtyId,
    binding.ptyIncarnationId
  ])
}

export function importedPhysicalWorkerPublicRouteKey(id: string, incarnationId: string): string {
  return JSON.stringify([id, incarnationId])
}

export function importedPhysicalWorkerCheckpoint(
  upstreamIdentity: ImportedPhysicalWorkerPtySession['upstreamIdentity'],
  downstreamIdentity: LegacyPhysicalWorkerDownstreamAttachment['identity'],
  creditedEndSu: number
): LegacyPtyProxyCursorCheckpoint {
  const checkpointId = `legacy-pty-cursor:${upstreamIdentity.providerGeneration}:${upstreamIdentity.deliveryToken}`
  return Object.freeze({
    checkpointId,
    acknowledgementId: `${checkpointId}:${creditedEndSu}`,
    identity: upstreamIdentity,
    downstreamIdentity,
    creditedEndSu
  })
}

export async function reattachImportedPhysicalWorkerDownstream(
  session: ImportedPhysicalWorkerPtySession,
  request: LegacyPhysicalWorkerAttachRequest,
  reportWorkerFault: (error: Error) => void
): Promise<LegacyPhysicalWorkerAttachResult | null> {
  if (
    !request.sourceRecovery &&
    request.context?.clientId === session.attachRequest.context?.clientId
  ) {
    session.attachRequest = request
    return Object.freeze({
      incarnationId: session.binding.ptyIncarnationId,
      sourceActivation: session.downstream.sourceActivation
    })
  }
  const reopened = session.downstream.reopen({
    id: session.binding.physicalPtyId,
    incarnationId: session.binding.ptyIncarnationId,
    ...(request.sourceRecovery ? { sourceRecovery: request.sourceRecovery } : {}),
    context: request.context,
    onCapacity: () => session.proxy.onDownstreamCapacity()
  })
  if (!reopened) {
    return null
  }
  if (reopened.status === 'restore-required') {
    return Object.freeze({
      incarnationId: session.binding.ptyIncarnationId,
      sourceRecovery: reopened.sourceRecovery
    })
  }
  session.downstream = reopened.attachment
  session.attachRequest = request
  try {
    await session.cursorStore.commit(
      importedPhysicalWorkerCheckpoint(
        session.upstreamIdentity,
        reopened.attachment.identity,
        session.proxy.snapshot().downstreamAckedEndSu
      )
    )
  } catch (error) {
    reportWorkerFault(error instanceof Error ? error : new Error(String(error)))
    throw error
  }
  session.proxy.retryDownstreamExit()
  return Object.freeze({
    incarnationId: session.binding.ptyIncarnationId,
    sourceActivation: reopened.attachment.sourceActivation,
    ...(reopened.sourceRecovery ? { sourceRecovery: reopened.sourceRecovery } : {})
  })
}
