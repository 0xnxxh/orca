import { isDeepStrictEqual } from 'node:util'
import type {
  TerminalLegacyMigrationImportRequest,
  TerminalLegacyRecoveryProjection,
  TerminalLegacyWorkerRoute
} from './terminal-legacy-cutover'
import { failTerminalSessionAuthority } from './terminal-session-authority-mutation'
import {
  legacyImportedPaneKey,
  legacyPhysicalPtyKey,
  legacyRouteMatchesCutover
} from './terminal-session-authority-legacy-transition'
import type { TerminalAuthorityLegacyStateLimits } from './terminal-session-authority-legacy-state'

type TerminalAuthorityLegacyAdmissionView = Readonly<{
  limits: TerminalAuthorityLegacyStateLimits
  migrationCount: number
  workersByRoute: ReadonlyMap<string, TerminalLegacyWorkerRoute>
  routeByWorker: ReadonlyMap<string, string>
  routeByOwner: ReadonlyMap<string, string>
  recoveriesById: ReadonlyMap<string, TerminalLegacyRecoveryProjection>
  recoveryByPhysicalPty: ReadonlyMap<string, string>
  importedPaneOwners: ReadonlyMap<string, string>
}>

export function assertTerminalAuthorityLegacyMigrationAdmission(
  request: TerminalLegacyMigrationImportRequest,
  view: TerminalAuthorityLegacyAdmissionView
): void {
  assertCapacity(request, view)
  if (request.mode === 'acknowledge') {
    const existing = view.recoveriesById.get(request.recoveryId)
    if (
      existing?.status !== 'unresolved' ||
      existing.catalogReceiptId !== request.expectedCatalogReceiptId
    ) {
      failTerminalSessionAuthority(
        'expectation-mismatch',
        'legacy recovery changed before acknowledgement'
      )
    }
    return
  }
  assertWorker(request, view)
  assertCandidates(request, view)
}

function assertCapacity(
  request: TerminalLegacyMigrationImportRequest,
  view: TerminalAuthorityLegacyAdmissionView
): void {
  const newRows = [...request.imports, ...request.unresolved].filter(
    (candidate) => !view.recoveriesById.has(candidate.recoveryId)
  ).length
  if (
    view.migrationCount >= view.limits.migrations ||
    (request.mode === 'cutover' &&
      !view.workersByRoute.has(request.workerRoute.routeId) &&
      view.workersByRoute.size >= view.limits.workers) ||
    view.recoveriesById.size + newRows > view.limits.recoveries
  ) {
    failTerminalSessionAuthority('capacity', 'legacy authority state capacity was exceeded')
  }
}

function assertWorker(
  request: Exclude<TerminalLegacyMigrationImportRequest, { mode: 'acknowledge' }>,
  view: TerminalAuthorityLegacyAdmissionView
): void {
  if (request.mode !== 'cutover') {
    return
  }
  const route = request.workerRoute
  const existingRoute = view.workersByRoute.get(route.routeId)
  const existingWorkerRoute = view.routeByWorker.get(route.workerId)
  const existingOwnerRoute = view.routeByOwner.get(route.ownerIncarnationId)
  if (
    (existingRoute !== undefined && !isDeepStrictEqual(existingRoute, route)) ||
    (existingWorkerRoute !== undefined && existingWorkerRoute !== route.routeId) ||
    (existingOwnerRoute !== undefined && existingOwnerRoute !== route.routeId) ||
    !legacyRouteMatchesCutover(route, request)
  ) {
    failTerminalSessionAuthority('operation-conflict', 'legacy worker route is not unique')
  }
}

function assertCandidates(
  request: Exclude<TerminalLegacyMigrationImportRequest, { mode: 'acknowledge' }>,
  view: TerminalAuthorityLegacyAdmissionView
): void {
  const workerId =
    request.mode === 'cutover' ? request.workerRoute.workerId : request.workerEvidence.workerId
  const recoveryIds = new Set<string>()
  const physicalPtys = new Set<string>()
  const panes = new Set<string>()
  for (const candidate of [...request.imports, ...request.unresolved]) {
    const physicalKey = legacyPhysicalPtyKey(candidate)
    const existing = view.recoveriesById.get(candidate.recoveryId)
    const physicalOwner = view.recoveryByPhysicalPty.get(physicalKey)
    const updatesExisting =
      existing?.status === 'unresolved' &&
      physicalOwner === candidate.recoveryId &&
      legacyPhysicalPtyKey(existing) === physicalKey
    if (
      candidate.physicalPty.workerId !== workerId ||
      recoveryIds.has(candidate.recoveryId) ||
      (existing !== undefined && !updatesExisting) ||
      physicalPtys.has(physicalKey) ||
      (physicalOwner !== undefined && physicalOwner !== candidate.recoveryId)
    ) {
      failTerminalSessionAuthority('operation-conflict', 'legacy recovery identity is not unique')
    }
    recoveryIds.add(candidate.recoveryId)
    physicalPtys.add(physicalKey)
    if ('pane' in candidate) {
      const paneKey = legacyImportedPaneKey(candidate)
      if (panes.has(paneKey) || view.importedPaneOwners.has(paneKey)) {
        failTerminalSessionAuthority('operation-conflict', 'legacy imported pane is duplicated')
      }
      panes.add(paneKey)
    }
  }
}
