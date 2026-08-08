import { isDeepStrictEqual } from 'node:util'
import type {
  TerminalLegacyImportedRecovery,
  TerminalLegacyMigrationImportRequest,
  TerminalLegacyRecoveryProjection,
  TerminalLegacyWorkerRoute
} from './terminal-legacy-cutover'
import { assertTerminalLegacyMigrationImportRequest } from './terminal-legacy-cutover-request-validation'
import {
  assertAuthorityId,
  type TerminalAuthorityNamespace
} from './terminal-session-authority-identity'
import {
  failTerminalSessionAuthority,
  TerminalSessionAuthorityError,
  type TerminalSessionAuthorityErrorCode,
  type TerminalSessionAuthorityLegacyMigration,
  type TerminalSessionAuthorityMutationRequest
} from './terminal-session-authority-mutation'
import {
  assertTerminalAuthorityLegacyMigrationEnvelope,
  deriveTerminalAuthorityLegacyMigration,
  legacyImportedPaneKey,
  legacyPhysicalPtyKey
} from './terminal-session-authority-legacy-transition'
import { assertTerminalAuthorityLegacyMigrationAdmission } from './terminal-session-authority-legacy-admission'
import {
  assertTerminalAuthorityLegacyMutationAllowed,
  assertTerminalAuthorityLegacyTopologyAllowed
} from './terminal-session-authority-legacy-mutation-fence'
import { assertRestoredTerminalAuthorityLegacyTopology } from './terminal-session-authority-legacy-topology-validation'
import type { TerminalSessionAuthorityTopology } from './terminal-session-authority-topology'
import { assertSafeInteger } from './terminal-session-authority-record-validation'
import { assertSemanticallyEqual } from './terminal-session-authority-semantic-equality'

export type TerminalAuthorityLegacyStateLimits = Readonly<{
  migrations: number
  workers: number
  recoveries: number
}>

export class TerminalSessionAuthorityLegacyState {
  private readonly migrationsById = new Map<string, TerminalSessionAuthorityLegacyMigration>()
  private readonly workersByRoute = new Map<string, TerminalLegacyWorkerRoute>()
  private readonly routeByWorker = new Map<string, string>()
  private readonly routeByOwner = new Map<string, string>()
  private readonly recoveriesById = new Map<string, TerminalLegacyRecoveryProjection>()
  private readonly recoveryByPhysicalPty = new Map<string, string>()
  private readonly importedPaneOwners = new Map<string, string>()
  private readonly liveOwnerIncarnations = new Set<string>()

  constructor(
    private readonly namespace: TerminalAuthorityNamespace,
    private readonly authorityOwnerIncarnationId: string,
    private readonly limits: TerminalAuthorityLegacyStateLimits
  ) {}

  get revision(): number {
    return this.migrationsById.size
  }

  hasMigration(migrationId: string): boolean {
    return this.migrationsById.has(migrationId)
  }

  migration(migrationId: string): TerminalSessionAuthorityLegacyMigration | null {
    const migration = this.migrationsById.get(migrationId)
    return migration ? structuredClone(migration) : null
  }

  recovery(recoveryId: string): TerminalLegacyRecoveryProjection | null {
    const recovery = this.recoveriesById.get(recoveryId)
    return recovery ? structuredClone(recovery) : null
  }

  workerRoute(routeId: string): TerminalLegacyWorkerRoute | null {
    const route = this.workersByRoute.get(routeId)
    return route ? structuredClone(route) : null
  }

  ownerIsReachable(ownerIncarnationId: string): boolean {
    return (
      ownerIncarnationId === this.authorityOwnerIncarnationId ||
      this.liveOwnerIncarnations.has(ownerIncarnationId)
    )
  }

  setOwnerReachable(ownerIncarnationId: string, reachable: boolean): boolean {
    assertAuthorityId(ownerIncarnationId, 'legacy ownerIncarnationId')
    if (ownerIncarnationId === this.authorityOwnerIncarnationId) {
      failTerminalSessionAuthority('record-corrupt', 'legacy owner aliases the authority process')
    }
    if (reachable) {
      if (this.liveOwnerIncarnations.has(ownerIncarnationId)) {
        return false
      }
      this.liveOwnerIncarnations.add(ownerIncarnationId)
      return true
    }
    return this.liveOwnerIncarnations.delete(ownerIncarnationId)
  }

  assertMutationAllowed(request: TerminalSessionAuthorityMutationRequest): void {
    assertTerminalAuthorityLegacyMutationAllowed(
      request,
      this.recoveriesById.values(),
      (workerId) => this.workerOwner(workerId)
    )
  }

  assertTopologyAllowed(
    migration: TerminalSessionAuthorityLegacyMigration,
    topology: TerminalSessionAuthorityTopology,
    errorCode: TerminalSessionAuthorityErrorCode
  ): void {
    const request = migration.receipt.request
    assertTerminalAuthorityLegacyTopologyAllowed(
      request.unresolved,
      request.imports.map((candidate) => candidate.pane.paneKey),
      topology.paneSnapshot(),
      topology.allocationSnapshot(),
      (workerId) =>
        request.mode === 'cutover' && request.workerRoute.workerId === workerId
          ? request.workerRoute.ownerIncarnationId
          : this.workerOwner(workerId),
      errorCode
    )
    const imports = migration.receipt.recoveries.filter(
      (row): row is TerminalLegacyImportedRecovery => row.status === 'imported'
    )
    try {
      topology.planLegacyImport(imports, migration.receipt.receiptId, migration.authorityRevision)
    } catch (error) {
      if (errorCode === 'record-corrupt') {
        failTerminalSessionAuthority('record-corrupt', 'legacy import conflicts with topology')
      }
      throw error
    }
  }

  plan(
    request: TerminalLegacyMigrationImportRequest,
    requestDigest: string,
    committedAtMs: number,
    authorityRevision: number
  ): Readonly<{ migration: TerminalSessionAuthorityLegacyMigration; duplicate: boolean }> {
    assertTerminalLegacyMigrationImportRequest(request)
    assertAuthorityId(requestDigest, 'legacy migration requestDigest')
    assertSafeInteger(committedAtMs, 'legacy migration committedAtMs')
    assertSafeInteger(authorityRevision, 'legacy migration authority revision', 1)
    this.assertNamespace(request)
    const existing = this.migrationsById.get(request.migrationId)
    if (existing) {
      if (
        existing.requestDigest !== requestDigest ||
        !isDeepStrictEqual(existing.receipt.request, request)
      ) {
        failTerminalSessionAuthority('operation-conflict', 'legacy migration ID was reused')
      }
      return Object.freeze({ migration: existing, duplicate: true })
    }
    assertTerminalAuthorityLegacyMigrationAdmission(request, {
      limits: this.limits,
      migrationCount: this.migrationsById.size,
      workersByRoute: this.workersByRoute,
      routeByWorker: this.routeByWorker,
      routeByOwner: this.routeByOwner,
      recoveriesById: this.recoveriesById,
      recoveryByPhysicalPty: this.recoveryByPhysicalPty,
      importedPaneOwners: this.importedPaneOwners
    })
    const migration = deriveTerminalAuthorityLegacyMigration(
      request,
      this.namespace,
      requestDigest,
      authorityRevision,
      this.migrationsById.size + 1,
      committedAtMs,
      (recoveryId) => this.recoveriesById.get(recoveryId)
    )
    return Object.freeze({ migration, duplicate: false })
  }

  apply(
    migration: TerminalSessionAuthorityLegacyMigration,
    topology: TerminalSessionAuthorityTopology,
    importTopology = true
  ): void {
    const planned = this.planPersistedMigration(migration)
    if (importTopology) {
      this.assertTopologyAllowed(migration, topology, 'record-corrupt')
    }
    if (planned.duplicate) {
      failTerminalSessionAuthority('record-corrupt', 'legacy migration repeats an operation')
    }
    assertSemanticallyEqual(planned.migration, migration, 'legacy migration is not canonical')
    const imports = migration.receipt.recoveries.filter(
      (row): row is TerminalLegacyImportedRecovery => row.status === 'imported'
    )
    if (importTopology && imports.length > 0) {
      topology.importLegacyRows(imports, migration.receipt.receiptId, migration.authorityRevision)
    }
    this.applyState(migration)
  }

  private planPersistedMigration(
    migration: TerminalSessionAuthorityLegacyMigration
  ): ReturnType<TerminalSessionAuthorityLegacyState['plan']> {
    try {
      assertTerminalAuthorityLegacyMigrationEnvelope(migration)
      if (!sameNamespace(migration.namespace, this.namespace)) {
        failTerminalSessionAuthority('record-corrupt', 'legacy migration authority changed')
      }
      return this.plan(
        migration.receipt.request,
        migration.requestDigest,
        migration.receipt.committedAtMs,
        migration.authorityRevision
      )
    } catch (error) {
      if (error instanceof TerminalSessionAuthorityError && error.code === 'record-corrupt') {
        throw error
      }
      failTerminalSessionAuthority('record-corrupt', 'legacy migration record is invalid')
    }
  }

  restore(
    migrations: readonly TerminalSessionAuthorityLegacyMigration[],
    topology: TerminalSessionAuthorityTopology
  ): void {
    for (const migration of migrations) {
      this.apply(migration, topology, false)
    }
    assertRestoredTerminalAuthorityLegacyTopology(this.recoverySnapshot(), topology, (workerId) =>
      this.workerOwner(workerId)
    )
  }

  migrationSnapshot(): readonly TerminalSessionAuthorityLegacyMigration[] {
    return Object.freeze(structuredClone([...this.migrationsById.values()]))
  }

  recoverySnapshot(): readonly TerminalLegacyRecoveryProjection[] {
    return Object.freeze(
      structuredClone(
        [...this.recoveriesById.values()].sort((left, right) =>
          left.recoveryId.localeCompare(right.recoveryId)
        )
      )
    )
  }

  workerRouteSnapshot(): readonly TerminalLegacyWorkerRoute[] {
    return Object.freeze(
      structuredClone(
        [...this.workersByRoute.values()].sort((left, right) =>
          left.routeId.localeCompare(right.routeId)
        )
      )
    )
  }

  private applyState(migration: TerminalSessionAuthorityLegacyMigration): void {
    this.migrationsById.set(migration.receipt.request.migrationId, migration)
    if (migration.receipt.request.mode === 'cutover') {
      const route = Object.freeze(structuredClone(migration.receipt.request.workerRoute))
      this.workersByRoute.set(route.routeId, route)
      this.routeByWorker.set(route.workerId, route.routeId)
      this.routeByOwner.set(route.ownerIncarnationId, route.routeId)
    }
    for (const recovery of migration.receipt.recoveries) {
      this.recoveriesById.set(recovery.recoveryId, recovery)
      this.recoveryByPhysicalPty.set(legacyPhysicalPtyKey(recovery), recovery.recoveryId)
      if (recovery.status === 'imported') {
        this.importedPaneOwners.set(legacyImportedPaneKey(recovery), recovery.recoveryId)
      }
    }
  }

  private assertNamespace(request: TerminalLegacyMigrationImportRequest): void {
    if (request.authorityHostId !== this.namespace.authorityHostId) {
      failTerminalSessionAuthority('expectation-mismatch', 'legacy migration authority changed')
    }
    for (const candidate of [...request.imports, ...request.unresolved]) {
      if (!sameNamespace(candidate.namespace, this.namespace)) {
        failTerminalSessionAuthority('expectation-mismatch', 'legacy migration namespace changed')
      }
    }
  }

  private workerOwner(workerId: string): string | null {
    const routeId = this.routeByWorker.get(workerId)
    return routeId ? (this.workersByRoute.get(routeId)?.ownerIncarnationId ?? null) : null
  }
}

function sameNamespace(
  left: TerminalAuthorityNamespace,
  right: TerminalAuthorityNamespace
): boolean {
  return left.authorityHostId === right.authorityHostId && left.namespaceId === right.namespaceId
}
