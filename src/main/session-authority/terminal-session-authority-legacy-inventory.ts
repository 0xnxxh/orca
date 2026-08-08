import { isDeepStrictEqual } from 'node:util'
import { assertTerminalLegacyMigrationImportRequest } from '../../shared/terminal-legacy-cutover-request-validation'
import type {
  TerminalLegacyMigrationImportRequest,
  TerminalLegacyMigrationReceipt,
  TerminalLegacyRecoveryProjection,
  TerminalLegacyWorkerRoute
} from '../../shared/terminal-legacy-cutover'
import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import { terminalAuthorityNamespaceLocatorKey } from '../../shared/terminal-session-authority-locator'
import { failTerminalSessionAuthority } from '../../shared/terminal-session-authority-mutation'
import { legacyPhysicalPtyKey } from '../../shared/terminal-session-authority-legacy-transition'
import type { TerminalSessionAuthorityService } from './terminal-session-authority-service'
import type { TerminalAuthorityLegacyProjectionSource } from './terminal-session-authority-legacy-projection'

export type TerminalAuthorityNamespaceMigration = Readonly<{
  namespace: TerminalAuthorityNamespace
  request: TerminalLegacyMigrationImportRequest
  service: TerminalSessionAuthorityService
}>

type TerminalAuthorityLegacyInventoryOptions = Readonly<{
  serviceForNamespace: (
    namespace: TerminalAuthorityNamespace
  ) => Promise<TerminalSessionAuthorityService>
  services: () => Iterable<TerminalSessionAuthorityService>
  namespaceMatchesLocator: (namespace: TerminalAuthorityNamespace, locatorKey: string) => boolean
}>

export async function prepareTerminalAuthorityNamespaceMigrations(
  request: TerminalLegacyMigrationImportRequest,
  options: TerminalAuthorityLegacyInventoryOptions
): Promise<TerminalAuthorityNamespaceMigration[]> {
  assertNamespaceEvidence(request, options)
  if (request.mode === 'acknowledge') {
    const matches = [...options.services()].filter((service) =>
      service.legacy
        .snapshot()
        .recoveries.some((recovery) => recovery.recoveryId === request.recoveryId)
    )
    if (matches.length !== 1) {
      failTerminalSessionAuthority('expectation-mismatch', 'legacy recovery namespace is ambiguous')
    }
    return [Object.freeze({ namespace: matches[0]!.namespace, request, service: matches[0]! })]
  }
  const byNamespace = new Map<string, TerminalAuthorityNamespace>()
  for (const candidate of [...request.imports, ...request.unresolved]) {
    byNamespace.set(candidate.namespace.namespaceId, candidate.namespace)
  }
  const entries: TerminalAuthorityNamespaceMigration[] = []
  for (const namespace of [...byNamespace.values()].sort((left, right) =>
    left.namespaceId.localeCompare(right.namespaceId)
  )) {
    const scoped = Object.freeze({
      ...structuredClone(request),
      imports: Object.freeze(
        request.imports.filter((candidate) => sameNamespace(candidate.namespace, namespace))
      ),
      unresolved: Object.freeze(
        request.unresolved.filter((candidate) => sameNamespace(candidate.namespace, namespace))
      )
    }) as TerminalLegacyMigrationImportRequest
    assertTerminalLegacyMigrationImportRequest(scoped)
    entries.push(
      Object.freeze({
        namespace,
        request: scoped,
        service: await options.serviceForNamespace(namespace)
      })
    )
  }
  return entries
}

export function assertTerminalAuthorityLegacyGlobalConsistency(
  request: TerminalLegacyMigrationImportRequest,
  requestDigest: string,
  services: Iterable<TerminalSessionAuthorityService>
): void {
  const serviceList = [...services]
  const source = terminalAuthorityLegacyProjectionSource(serviceList)
  const existingOperation = source.migrations.filter(
    (migration) => migration.receipt.request.migrationId === request.migrationId
  )
  if (existingOperation.some((migration) => migration.requestDigest !== requestDigest)) {
    failTerminalSessionAuthority('operation-conflict', 'legacy migration ID was reused')
  }
  if (request.mode === 'acknowledge') {
    return
  }
  const recoveries = new Map(source.recoveries.map((row) => [row.recoveryId, row]))
  const physicalPtys = new Map(
    source.recoveries.map((row) => [legacyPhysicalPtyKey(row), row.recoveryId])
  )
  const duplicateNamespaces = new Set(
    existingOperation.map((migration) => migration.namespace.namespaceId)
  )
  const requestRecoveryIds = new Set<string>()
  const requestPhysicalPtys = new Set<string>()
  for (const candidate of [...request.imports, ...request.unresolved]) {
    if (duplicateNamespaces.has(candidate.namespace.namespaceId)) {
      continue
    }
    const existing = recoveries.get(candidate.recoveryId)
    const physicalKey = legacyPhysicalPtyKey(candidate)
    const physicalOwner = physicalPtys.get(physicalKey)
    const updatesExisting =
      existing?.status === 'unresolved' &&
      sameNamespace(existing.namespace, candidate.namespace) &&
      physicalOwner === candidate.recoveryId
    if (
      (existing && !updatesExisting) ||
      (physicalOwner !== undefined && physicalOwner !== candidate.recoveryId) ||
      requestRecoveryIds.has(candidate.recoveryId) ||
      requestPhysicalPtys.has(physicalKey)
    ) {
      failTerminalSessionAuthority('operation-conflict', 'legacy inventory identity is not unique')
    }
    requestRecoveryIds.add(candidate.recoveryId)
    requestPhysicalPtys.add(physicalKey)
  }
  if (request.mode === 'cutover') {
    assertGlobalRoute(request.workerRoute, source.workerRoutes)
  }
}

export function terminalAuthorityLegacyProjectionSource(
  services: Iterable<TerminalSessionAuthorityService>
): TerminalAuthorityLegacyProjectionSource {
  const snapshots = [...services].map((service) => service.legacy.snapshot())
  const workerRoutes = new Map<string, TerminalLegacyWorkerRoute>()
  const recoveries = new Map<string, TerminalLegacyRecoveryProjection>()
  for (const snapshot of snapshots) {
    for (const route of snapshot.workerRoutes) {
      const existing = workerRoutes.get(route.routeId)
      if (existing && !isDeepStrictEqual(existing, route)) {
        failTerminalSessionAuthority('record-corrupt', 'legacy worker route is inconsistent')
      }
      workerRoutes.set(route.routeId, route)
    }
    for (const recovery of snapshot.recoveries) {
      if (recoveries.has(recovery.recoveryId)) {
        failTerminalSessionAuthority('record-corrupt', 'legacy recovery spans namespaces')
      }
      recoveries.set(recovery.recoveryId, recovery)
    }
  }
  return Object.freeze({
    revision: snapshots.reduce((total, snapshot) => total + snapshot.revision, 0),
    migrations: Object.freeze(snapshots.flatMap((snapshot) => [...snapshot.migrations])),
    recoveries: Object.freeze([...recoveries.values()]),
    workerRoutes: Object.freeze([...workerRoutes.values()])
  })
}

export function aggregateTerminalAuthorityLegacyReceipt(
  request: TerminalLegacyMigrationImportRequest,
  committed: readonly Awaited<ReturnType<TerminalSessionAuthorityService['legacy']['apply']>>[]
): TerminalLegacyMigrationReceipt {
  return Object.freeze({
    version: 1,
    receiptId: request.migrationId,
    sequence: Math.max(...committed.map((entry) => entry.migration.receipt.sequence)),
    committedAtMs: Math.max(...committed.map((entry) => entry.migration.receipt.committedAtMs)),
    request: Object.freeze(structuredClone(request)),
    recoveries: Object.freeze(
      committed
        .flatMap((entry) => [...entry.migration.receipt.recoveries])
        .sort((left, right) => left.recoveryId.localeCompare(right.recoveryId))
    )
  })
}

function assertNamespaceEvidence(
  request: TerminalLegacyMigrationImportRequest,
  options: TerminalAuthorityLegacyInventoryOptions
): void {
  for (const candidate of [...request.imports, ...request.unresolved]) {
    if (
      !options.namespaceMatchesLocator(
        candidate.namespace,
        terminalAuthorityNamespaceLocatorKey(candidate.workspace.locator)
      )
    ) {
      failTerminalSessionAuthority(
        'expectation-mismatch',
        'legacy migration namespace does not match its workspace evidence'
      )
    }
  }
}

function assertGlobalRoute(
  route: TerminalLegacyWorkerRoute,
  existing: readonly TerminalLegacyWorkerRoute[]
): void {
  for (const current of existing) {
    if (
      (current.routeId === route.routeId && !isDeepStrictEqual(current, route)) ||
      (current.workerId === route.workerId && current.routeId !== route.routeId) ||
      (current.ownerIncarnationId === route.ownerIncarnationId && current.routeId !== route.routeId)
    ) {
      failTerminalSessionAuthority('operation-conflict', 'legacy worker route is not unique')
    }
  }
}

function sameNamespace(
  left: TerminalAuthorityNamespace,
  right: TerminalAuthorityNamespace
): boolean {
  return left.authorityHostId === right.authorityHostId && left.namespaceId === right.namespaceId
}
