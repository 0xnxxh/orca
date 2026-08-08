import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { assertTerminalLegacyMigrationImportRequest } from '../../shared/terminal-legacy-cutover-request-validation'
import type {
  TerminalLegacyCutoverProjection,
  TerminalLegacyGcProtection,
  TerminalLegacyMigrationImportRequest,
  TerminalLegacyMigrationReceipt,
  TerminalLegacyRecoveryNoticeProjection,
  TerminalLegacyWorkerRoute
} from '../../shared/terminal-legacy-cutover'
import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import { failTerminalSessionAuthority } from '../../shared/terminal-session-authority-mutation'
import { terminalLegacyMigrationRequestDigest } from '../../shared/terminal-session-authority-legacy-transition'
import type { TerminalLegacyWorkerLiveRegistration } from './terminal-legacy-worker-live-registration'
import {
  assertTerminalLegacyWorkerLiveRegistration,
  assertTerminalLegacyWorkerMatchesRoute
} from './terminal-legacy-worker-live-registration'
import type { TerminalSessionAuthorityService } from './terminal-session-authority-service'
import type { TerminalAuthorityLegacyMigrationAccess } from './terminal-session-authority-legacy-migration'
import type { TerminalAuthorityLegacyWorkerAccess } from './terminal-session-authority-service-contract'
import {
  aggregateTerminalAuthorityLegacyReceipt,
  assertTerminalAuthorityLegacyGlobalConsistency,
  prepareTerminalAuthorityNamespaceMigrations,
  terminalAuthorityLegacyProjectionSource,
  type TerminalAuthorityNamespaceMigration
} from './terminal-session-authority-legacy-inventory'
import {
  projectTerminalAuthorityLegacyCutover,
  projectTerminalAuthorityLegacyNotices,
  terminalAuthorityLegacyGcProtection,
  terminalAuthorityLegacyPhysicalWorkers,
  type TerminalLegacyPhysicalWorkerAuthorityEntry
} from './terminal-session-authority-legacy-projection'

type ReservedNamespaceMigration = TerminalAuthorityNamespaceMigration &
  Readonly<{ access: TerminalAuthorityLegacyMigrationAccess }>

export type TerminalAuthorityLegacyRegistryOptions = Readonly<{
  serviceForNamespace: (
    namespace: TerminalAuthorityNamespace
  ) => Promise<TerminalSessionAuthorityService>
  services: () => Iterable<TerminalSessionAuthorityService>
  namespaceMatchesLocator: (namespace: TerminalAuthorityNamespace, locatorKey: string) => boolean
  assertNamespace: (namespace: TerminalAuthorityNamespace) => void
  assertAccepting: () => void
  now?: () => number
}>

export class TerminalSessionAuthorityLegacyRegistry {
  readonly workerAccess: TerminalAuthorityLegacyWorkerAccess = Object.freeze({
    role: 'legacy-worker-owner',
    accessId: randomUUID()
  })
  private readonly liveWorkers = new Map<string, TerminalLegacyWorkerLiveRegistration>()
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: TerminalAuthorityLegacyRegistryOptions) {}

  async importMigration(
    request: TerminalLegacyMigrationImportRequest
  ): Promise<Readonly<{ receipt: TerminalLegacyMigrationReceipt; duplicate: boolean }>> {
    const migration = structuredClone(request)
    return this.enqueue(() => this.commitMigration(migration))
  }

  projection(): TerminalLegacyCutoverProjection {
    this.options.assertAccepting()
    return projectTerminalAuthorityLegacyCutover(
      terminalAuthorityLegacyProjectionSource(this.options.services())
    )
  }

  recoveryNotices(): TerminalLegacyRecoveryNoticeProjection {
    this.options.assertAccepting()
    const source = terminalAuthorityLegacyProjectionSource(this.options.services())
    return projectTerminalAuthorityLegacyNotices(source.revision, source.recoveries)
  }

  recoveryNoticesForNamespace(
    namespace: TerminalAuthorityNamespace
  ): TerminalLegacyRecoveryNoticeProjection {
    this.options.assertAccepting()
    this.options.assertNamespace(namespace)
    const service = [...this.options.services()].find(
      (candidate) => candidate.namespace.namespaceId === namespace.namespaceId
    )
    const snapshot = service?.legacy.snapshot()
    return projectTerminalAuthorityLegacyNotices(
      snapshot?.revision ?? 0,
      snapshot?.recoveries ?? []
    )
  }

  gcProtection(): TerminalLegacyGcProtection {
    this.options.assertAccepting()
    return terminalAuthorityLegacyGcProtection(
      terminalAuthorityLegacyProjectionSource(this.options.services())
    )
  }

  physicalWorkerEntries(): readonly TerminalLegacyPhysicalWorkerAuthorityEntry[] {
    this.options.assertAccepting()
    return terminalAuthorityLegacyPhysicalWorkers(
      terminalAuthorityLegacyProjectionSource(this.options.services()).migrations
    )
  }

  activateWorker(registration: TerminalLegacyWorkerLiveRegistration): Promise<boolean> {
    const candidate = structuredClone(registration)
    return this.enqueue(() => this.activateWorkerNow(candidate))
  }

  deactivateWorker(routeId: string, registrationId: string): Promise<boolean> {
    return this.enqueue(() => this.deactivateWorkerNow(routeId, registrationId))
  }

  idle(): Promise<void> {
    return this.mutationQueue
  }

  async reconcileLiveOwners(service: TerminalSessionAuthorityService): Promise<void> {
    for (const registration of this.liveWorkers.values()) {
      await service.legacy.setOwnerReachable(
        service.writerAccess,
        this.workerAccess,
        registration.ownerIncarnationId,
        true
      )
    }
  }

  private async commitMigration(
    migration: TerminalLegacyMigrationImportRequest
  ): Promise<Readonly<{ receipt: TerminalLegacyMigrationReceipt; duplicate: boolean }>> {
    assertTerminalLegacyMigrationImportRequest(migration)
    const requestDigest = terminalLegacyMigrationRequestDigest(migration)
    const namespaces = await prepareTerminalAuthorityNamespaceMigrations(migration, this.options)
    assertTerminalAuthorityLegacyGlobalConsistency(
      migration,
      requestDigest,
      this.options.services()
    )
    const committedAtMs = (this.options.now ?? Date.now)()
    const reserved: ReservedNamespaceMigration[] = []
    try {
      for (const entry of namespaces) {
        const access = await entry.service.legacy.reserve(
          entry.service.writerAccess,
          entry.request,
          requestDigest,
          committedAtMs
        )
        reserved.push(Object.freeze({ ...entry, access }))
      }
      const committed: Awaited<ReturnType<TerminalSessionAuthorityService['legacy']['apply']>>[] =
        []
      for (const entry of reserved) {
        committed.push(
          await entry.service.legacy.apply(entry.service.writerAccess, entry.request, entry.access)
        )
      }
      return Object.freeze({
        receipt: aggregateTerminalAuthorityLegacyReceipt(migration, committed),
        duplicate: committed.every((entry) => entry.duplicate)
      })
    } finally {
      await Promise.allSettled(
        reserved.map(
          async (entry) =>
            await entry.service.legacy.finish(entry.service.writerAccess, entry.access)
        )
      )
    }
  }

  private workerRoute(routeId: string): TerminalLegacyWorkerRoute | null {
    const matches = [...this.options.services()]
      .flatMap((service) =>
        service.legacy.snapshot().workerRoutes.filter((route) => route.routeId === routeId)
      )
      .filter((route): route is TerminalLegacyWorkerRoute => route !== null)
    if (matches.some((route) => !isDeepStrictEqual(route, matches[0]))) {
      failTerminalSessionAuthority('record-corrupt', 'legacy route differs across namespaces')
    }
    return matches[0] ? structuredClone(matches[0]) : null
  }

  private async activateWorkerNow(
    registration: TerminalLegacyWorkerLiveRegistration
  ): Promise<boolean> {
    assertTerminalLegacyWorkerLiveRegistration(registration)
    assertTerminalLegacyWorkerMatchesRoute(registration, this.workerRoute(registration.routeId))
    const current = this.liveWorkers.get(registration.routeId)
    if (current?.registrationId === registration.registrationId) {
      if (!isDeepStrictEqual(current, registration)) {
        failTerminalSessionAuthority(
          'operation-conflict',
          'legacy live-worker registration ID was reused'
        )
      }
      return false
    }
    this.liveWorkers.set(registration.routeId, structuredClone(registration))
    await this.setServicesOwnerReachable(registration.ownerIncarnationId, true)
    return true
  }

  private async deactivateWorkerNow(routeId: string, registrationId: string): Promise<boolean> {
    const current = this.liveWorkers.get(routeId)
    if (!current || current.registrationId !== registrationId) {
      return false
    }
    this.liveWorkers.delete(routeId)
    await this.setServicesOwnerReachable(current.ownerIncarnationId, false)
    return true
  }

  private async setServicesOwnerReachable(
    ownerIncarnationId: string,
    reachable: boolean
  ): Promise<void> {
    await Promise.all(
      [...this.options.services()].map((service) =>
        service.legacy.setOwnerReachable(
          service.writerAccess,
          this.workerAccess,
          ownerIncarnationId,
          reachable
        )
      )
    )
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    this.options.assertAccepting()
    const result = this.mutationQueue.then(operation)
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}
