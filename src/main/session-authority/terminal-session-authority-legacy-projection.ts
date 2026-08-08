import type {
  TerminalLegacyCutoverProjection,
  TerminalLegacyCutoverProof,
  TerminalLegacyGcProtection,
  TerminalLegacyRecoveryNotice,
  TerminalLegacyRecoveryNoticeProjection,
  TerminalLegacyRecoveryProjection,
  TerminalLegacyRecoveryView,
  TerminalLegacyWorkerRoute
} from '../../shared/terminal-legacy-cutover'
import type { TerminalSessionAuthorityLegacyMigration } from '../../shared/terminal-session-authority-mutation'
import { projectLegacyWorkerRoute } from '../../shared/terminal-session-authority-legacy-transition'

export type TerminalLegacyPhysicalWorkerAuthorityEntry = Readonly<{
  route: TerminalLegacyWorkerRoute
  cutover: TerminalLegacyCutoverProof
}>

export type TerminalAuthorityLegacyProjectionSource = Readonly<{
  revision: number
  migrations: readonly TerminalSessionAuthorityLegacyMigration[]
  recoveries: readonly TerminalLegacyRecoveryProjection[]
  workerRoutes: readonly TerminalLegacyWorkerRoute[]
}>

export function projectTerminalAuthorityLegacyCutover(
  source: TerminalAuthorityLegacyProjectionSource
): TerminalLegacyCutoverProjection {
  const routes = new Map(
    source.workerRoutes.map((route) => [route.routeId, projectLegacyWorkerRoute(route)])
  )
  const recoveries: TerminalLegacyRecoveryView[] = source.recoveries.map((row) =>
    Object.freeze(
      structuredClone({
        ...row,
        workerRoute: row.status === 'imported' ? (routes.get(row.routeId) ?? null) : null
      })
    )
  )
  return Object.freeze({
    version: 1,
    revision: source.revision,
    workers: Object.freeze(
      [...routes.values()].sort((left, right) => left.routeId.localeCompare(right.routeId))
    ),
    recoveries: Object.freeze(
      recoveries.sort((left, right) => left.recoveryId.localeCompare(right.recoveryId))
    )
  })
}

export function projectTerminalAuthorityLegacyNotices(
  revision: number,
  rows: readonly TerminalLegacyRecoveryProjection[]
): TerminalLegacyRecoveryNoticeProjection {
  const notices = rows
    .map(projectRecoveryNotice)
    .sort((left, right) => left.recoveryKey.localeCompare(right.recoveryKey))
  return Object.freeze({ version: 1, revision, notices: Object.freeze(notices) })
}

export function terminalAuthorityLegacyGcProtection(
  source: TerminalAuthorityLegacyProjectionSource
): TerminalLegacyGcProtection {
  const protectedWorkers = new Set(
    source.recoveries
      .filter((row) => row.status !== 'acknowledged')
      .map((row) => row.physicalPty.workerId)
  )
  const relayDirectories = new Set<string>()
  const evidencePaths = new Set<string>()
  for (const migration of source.migrations) {
    const request = migration.receipt.request
    if (request.mode === 'acknowledge') {
      continue
    }
    const workerId =
      request.mode === 'cutover' ? request.workerRoute.workerId : request.workerEvidence.workerId
    if (!protectedWorkers.has(workerId)) {
      continue
    }
    const protection =
      request.mode === 'cutover'
        ? request.workerRoute.gcProtection
        : request.workerEvidence.gcProtection
    protection.relayDirectories.forEach((directory) => relayDirectories.add(directory))
    protection.evidencePaths.forEach((evidencePath) => evidencePaths.add(evidencePath))
  }
  return Object.freeze({
    relayDirectories: Object.freeze([...relayDirectories].sort()),
    evidencePaths: Object.freeze([...evidencePaths].sort())
  })
}

export function terminalAuthorityLegacyPhysicalWorkers(
  migrations: readonly TerminalSessionAuthorityLegacyMigration[]
): readonly TerminalLegacyPhysicalWorkerAuthorityEntry[] {
  const entries = new Map<string, TerminalLegacyPhysicalWorkerAuthorityEntry>()
  for (const migration of migrations) {
    const request = migration.receipt.request
    if (request.mode !== 'cutover') {
      continue
    }
    entries.set(
      request.workerRoute.routeId,
      Object.freeze({
        route: structuredClone(request.workerRoute),
        cutover: structuredClone(request.cutover)
      })
    )
  }
  return Object.freeze(
    [...entries.values()].sort((left, right) =>
      left.route.routeId.localeCompare(right.route.routeId)
    )
  )
}

function projectRecoveryNotice(
  row: TerminalLegacyRecoveryProjection
): TerminalLegacyRecoveryNotice {
  const base = {
    recoveryKey: row.recoveryId,
    workspaceKind: row.workspace.kind,
    evidenceDigest: row.inventoryEvidence.evidenceDigest,
    observedAtMs: row.inventoryEvidence.observedAtMs,
    discoveredAtMs: row.discoveredAtMs,
    updatedAtMs: row.updatedAtMs
  }
  return row.status === 'imported'
    ? Object.freeze({ ...base, status: row.status })
    : Object.freeze({
        ...base,
        status: row.status,
        reason: row.reason,
        preservationKind: row.preservation.kind
      })
}
