import type { PtySourceDeliveryIdentity } from '../shared/pty-source-credit-contract'
import {
  importedPhysicalWorkerBindingKey,
  importedPhysicalWorkerPublicRouteKey,
  type ImportedPhysicalWorkerPtySession
} from './legacy-physical-worker-authority-session'
import type { LegacyPhysicalWorkerEventRouter } from './legacy-physical-worker-event-router'

export class LegacyPhysicalWorkerAuthoritySessionRegistry {
  constructor(
    private readonly sessionsByBinding: Map<string, ImportedPhysicalWorkerPtySession>,
    private readonly sessionsByPublicRoute: Map<string, ImportedPhysicalWorkerPtySession>,
    private readonly eventRouter: LegacyPhysicalWorkerEventRouter
  ) {}

  downstreamSession(identity: PtySourceDeliveryIdentity): ImportedPhysicalWorkerPtySession | null {
    const session = this.sessionsByPublicRoute.get(
      importedPhysicalWorkerPublicRouteKey(identity.id, identity.ptyIncarnation)
    )
    const downstream = session?.downstream.identity
    return session &&
      !session.retired &&
      !session.downstreamRotating &&
      session.route.isCurrent() &&
      downstream &&
      downstream.deliveryToken === identity.deliveryToken &&
      downstream.clientGeneration === identity.clientGeneration &&
      downstream.ownerGeneration === identity.ownerGeneration
      ? session
      : null
  }

  maybeRetire(session: ImportedPhysicalWorkerPtySession): void {
    const snapshot = session.proxy.snapshot()
    if (
      !session.exitRecorded ||
      snapshot.exitState !== 'published' ||
      snapshot.upstreamAckedEndSu !== snapshot.receivedEndSu ||
      this.sessionsByBinding.get(importedPhysicalWorkerBindingKey(session.binding)) !== session
    ) {
      return
    }
    this.retireSession(session)
  }

  retireSession(session: ImportedPhysicalWorkerPtySession): void {
    if (session.retired) {
      return
    }
    session.retired = true
    const bindingKey = importedPhysicalWorkerBindingKey(session.binding)
    const publicRouteKey = importedPhysicalWorkerPublicRouteKey(
      session.binding.physicalPtyId,
      session.binding.ptyIncarnationId
    )
    if (this.sessionsByBinding.get(bindingKey) === session) {
      this.sessionsByBinding.delete(bindingKey)
    }
    if (this.sessionsByPublicRoute.get(publicRouteKey) === session) {
      this.sessionsByPublicRoute.delete(publicRouteKey)
    }
    this.eventRouter.unregisterSession(session)
    session.downstream.dispose()
    session.proxy.dispose()
  }

  dispose(): void {
    for (const session of this.sessionsByBinding.values()) {
      session.downstream.dispose()
      session.proxy.dispose()
    }
    this.sessionsByBinding.clear()
    this.sessionsByPublicRoute.clear()
    this.eventRouter.dispose()
  }
}
