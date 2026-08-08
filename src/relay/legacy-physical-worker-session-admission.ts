import { parsePtySourceReceivingActivation } from '../shared/pty-source-receiving-activation'
import type {
  LegacyPhysicalWorkerAttachRequest,
  LegacyPhysicalWorkerAttachResult
} from './legacy-physical-worker-attach-router'
import type {
  ImportedPhysicalWorkerPtySession,
  LegacyPhysicalWorkerAuthorityRouterOptions
} from './legacy-physical-worker-authority-session'
import {
  importedPhysicalWorkerBindingKey,
  importedPhysicalWorkerCheckpoint,
  importedPhysicalWorkerPublicRouteKey,
  reattachImportedPhysicalWorkerDownstream,
  sameImportedPhysicalWorkerBinding
} from './legacy-physical-worker-authority-session'
import type { LegacyPhysicalWorkerEventRouter } from './legacy-physical-worker-event-router'
import { parseLegacyPhysicalWorkerActivation } from './legacy-physical-worker-source-event'
import { OrderedLegacyPtyProxy } from './legacy-pty-proxy'

export type LegacyPhysicalWorkerSessionAdmissionState = Readonly<{
  sessionsByBinding: Map<string, ImportedPhysicalWorkerPtySession>
  sessionsByPublicRoute: Map<string, ImportedPhysicalWorkerPtySession>
  eventRouter: LegacyPhysicalWorkerEventRouter
  maxSessions: number
  options: LegacyPhysicalWorkerAuthorityRouterOptions
  reportFault: (error: Error) => void
  retireSession: (session: ImportedPhysicalWorkerPtySession) => void
  onExitPublished: (
    session: ImportedPhysicalWorkerPtySession,
    exit: Parameters<ImportedPhysicalWorkerPtySession['downstream']['publishExit']>[0]
  ) => void
}>

export async function admitLegacyPhysicalWorkerSession(
  state: LegacyPhysicalWorkerSessionAdmissionState,
  request: LegacyPhysicalWorkerAttachRequest
): Promise<LegacyPhysicalWorkerAttachResult | null> {
  const binding = request.binding
  const bindingKey = importedPhysicalWorkerBindingKey(binding)
  const publicRouteKey = importedPhysicalWorkerPublicRouteKey(
    binding.physicalPtyId,
    binding.ptyIncarnationId
  )
  const current = state.sessionsByBinding.get(bindingKey)
  const publicCollision = state.sessionsByPublicRoute.get(publicRouteKey)
  if (publicCollision && !sameImportedPhysicalWorkerBinding(publicCollision.binding, binding)) {
    throw new Error('legacy physical PTY public route identity is ambiguous')
  }
  if (!current && state.sessionsByBinding.size >= state.maxSessions) {
    throw new Error('legacy physical PTY session capacity exceeded')
  }
  const route = await state.options.registry.resolveExactPtyRoute(binding.ownerIncarnationId, {
    id: binding.physicalPtyId,
    incarnationId: binding.ptyIncarnationId
  })
  if (!route?.isCurrent()) {
    return null
  }
  state.eventRouter.ensureSubscription(route.client)
  if (
    current?.client === route.client &&
    current.route.generation === route.generation &&
    current.route.isCurrent()
  ) {
    current.downstreamRotating = true
    try {
      await current.ackTask
      if (current.retired || !current.route.isCurrent()) {
        return null
      }
      return await reattachImportedPhysicalWorkerDownstream(current, request, state.reportFault)
    } finally {
      current.downstreamRotating = false
    }
  }
  const restored = state.options.cursors.restore(bindingKey)
  const checkpointSourceEndSu = restored?.checkpoint.creditedEndSu ?? 0
  let session: ImportedPhysicalWorkerPtySession | null = null
  const openedDownstream = state.options.downstream.open({
    id: binding.physicalPtyId,
    incarnationId: binding.ptyIncarnationId,
    checkpointSourceEndSu,
    ...(request.sourceRecovery ? { sourceRecovery: request.sourceRecovery } : {}),
    ...(restored?.checkpoint.downstreamIdentity
      ? { durableDownstreamIdentity: restored.checkpoint.downstreamIdentity }
      : {}),
    context: request.context,
    onCapacity: () => session?.proxy.onDownstreamCapacity()
  })
  if (!openedDownstream) {
    return null
  }
  if (openedDownstream.status === 'restore-required') {
    return Object.freeze({
      incarnationId: binding.ptyIncarnationId,
      sourceRecovery: openedDownstream.sourceRecovery
    })
  }
  const downstream = openedDownstream.attachment
  let upstream
  try {
    upstream = await route.client.attach(
      {
        id: binding.physicalPtyId,
        incarnationId: binding.ptyIncarnationId,
        expectedPaneKey: request.pane.paneKey,
        ...(request.expectedTabId ? { expectedTabId: request.expectedTabId } : {})
      },
      restored?.sourceRecovery
    )
  } catch (error) {
    downstream.dispose()
    throw error
  }
  const activation = parsePtySourceReceivingActivation(upstream.sourceActivation)
  if (!activation || activation.ptyIncarnation !== binding.ptyIncarnationId) {
    downstream.dispose()
    throw new Error('legacy physical worker did not activate source credit')
  }
  const upstreamIdentity = parseLegacyPhysicalWorkerActivation(
    activation,
    binding.physicalPtyId,
    binding.ptyIncarnationId
  )
  if (!route.isCurrent()) {
    downstream.dispose()
    return null
  }
  if (current) {
    state.retireSession(current)
  }
  const cursorStore = state.options.cursors.checkpointStore(bindingKey)
  try {
    await cursorStore.commit(
      importedPhysicalWorkerCheckpoint(upstreamIdentity, downstream.identity, checkpointSourceEndSu)
    )
  } catch (error) {
    downstream.dispose()
    state.reportFault(error instanceof Error ? error : new Error(String(error)))
    throw error
  }
  const proxy = new OrderedLegacyPtyProxy(
    upstreamIdentity,
    {
      publishData: (span, onSettled) => session?.downstream.publishData(span, onSettled) ?? false,
      publishExit: (exit, onSettled) =>
        session?.downstream.publishExit(exit, (settlement) => {
          onSettled(settlement)
          if (settlement.ok && session) {
            state.onExitPublished(session, exit)
          }
        }) ?? false
    },
    {
      commit: (checkpoint) =>
        cursorStore.commit(
          Object.freeze({
            ...checkpoint,
            downstreamIdentity: session?.downstream.identity ?? downstream.identity
          })
        )
    },
    (ack, acknowledgementId) => route.client.publishSourceAcknowledgement(ack, acknowledgementId),
    undefined,
    0,
    restored?.cursor
  )
  session = {
    binding: Object.freeze({ ...binding }),
    client: route.client,
    route,
    upstreamIdentity,
    downstream,
    proxy,
    cursorStore,
    ackTask: null,
    requestedAckEndSu: checkpointSourceEndSu,
    mutationTail: Promise.resolve(),
    exitRecorded: false,
    exitRecording: false,
    pendingExitCode: null,
    upstreamExited: false,
    retired: false,
    downstreamRotating: false,
    attachRequest: request
  }
  state.sessionsByBinding.set(bindingKey, session)
  state.sessionsByPublicRoute.set(publicRouteKey, session)
  state.eventRouter.ensureSubscription(route.client)
  state.eventRouter.registerSession(session)
  return Object.freeze({
    incarnationId: binding.ptyIncarnationId,
    sourceActivation: downstream.sourceActivation,
    ...(openedDownstream.sourceRecovery ? { sourceRecovery: openedDownstream.sourceRecovery } : {})
  })
}
