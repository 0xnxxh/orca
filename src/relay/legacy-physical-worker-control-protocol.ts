import type {
  TerminalLegacyEndpointIdentity,
  TerminalLegacyImportCandidate,
  TerminalLegacyProcessIdentity,
  TerminalLegacyUnresolvedCandidate
} from '../shared/terminal-legacy-cutover'
import {
  assertAuthorityId,
  assertAuthorityStoragePath,
  isRecord
} from '../shared/terminal-session-authority-identity'

export const LEGACY_PHYSICAL_WORKER_INSPECT_METHOD =
  'terminalAuthority.legacyPhysicalWorker.inspect'
export const LEGACY_PHYSICAL_WORKER_MIGRATE_METHOD =
  'terminalAuthority.legacyPhysicalWorker.migrate'
export const LEGACY_PHYSICAL_WORKER_GC_PROTECTION_METHOD =
  'terminalAuthority.legacyPhysicalWorker.gcProtection'
export const LEGACY_PHYSICAL_WORKER_MIGRATION_BARRIER_METHOD =
  'terminalAuthority.legacyPhysicalWorker.migrationBarrier'
export const LEGACY_PHYSICAL_WORKER_GC_METHOD = 'terminalAuthority.legacyPhysicalWorker.gc'

type LegacyPhysicalWorkerDescriptorBase = Readonly<{
  version: 1
  workerId: string
  routeId: string
  ownerIncarnationId: string
  buildId: string
  clientInstanceId: string
  relayDirectory: string
  process: TerminalLegacyProcessIdentity
  expectedEndpoint: TerminalLegacyEndpointIdentity
  requestedSourceWindowSu: number
  publicCredentialFile: string
  privateCredentialFile: string
  privateStateDirectory: string
}>

export type LegacyPhysicalWorkerDescriptor = LegacyPhysicalWorkerDescriptorBase &
  (
    | Readonly<{
        platform: 'linux' | 'darwin'
        publicSocketPath: string
        privateSocketPath: string
      }>
    | Readonly<{
        platform: 'win32'
        pipeName: string
        activePipeMarkerPath: string
        privateActivePipeMarkerPath: string
      }>
  )

export type LegacyPhysicalWorkerMigrationCatalogInput = Readonly<{
  migrationId: string
  authorityHostId: string
  requestedAtMs: number
  imports: readonly TerminalLegacyImportCandidate[]
  unresolved: readonly TerminalLegacyUnresolvedCandidate[]
}>

export type LegacyPhysicalWorkerInspectRequest = Readonly<{
  version: 1
  worker: LegacyPhysicalWorkerDescriptor
}>

export type LegacyPhysicalWorkerMigrateRequest = Readonly<{
  version: 1
  worker: LegacyPhysicalWorkerDescriptor
  catalog: LegacyPhysicalWorkerMigrationCatalogInput
}>

export type LegacyPhysicalWorkerMigrationBarrierRequest = Readonly<{
  version: 1
  barrierId: string
  expectedCatalogRevision: number
}>

export type LegacyPhysicalWorkerGcProtectionRequest = Readonly<{ version: 1 }>

export type LegacyPhysicalWorkerGcRequest = Readonly<{
  version: 1
  barrierId: string
}>

export function parseLegacyPhysicalWorkerInspectRequest(
  value: Record<string, unknown>
): LegacyPhysicalWorkerInspectRequest {
  if (value.version !== 1 || !isRecord(value.worker)) {
    throw new Error('legacy physical worker inspect request is invalid')
  }
  return Object.freeze({ version: 1, worker: parseWorker(value.worker) })
}

export function parseLegacyPhysicalWorkerMigrateRequest(
  value: Record<string, unknown>
): LegacyPhysicalWorkerMigrateRequest {
  if (value.version !== 1 || !isRecord(value.worker) || !isRecord(value.catalog)) {
    throw new Error('legacy physical worker migration request is invalid')
  }
  const catalog = value.catalog
  assertAuthorityId(catalog.migrationId, 'legacy migrationId')
  assertAuthorityId(catalog.authorityHostId, 'legacy authorityHostId')
  if (
    !nonNegativeInteger(catalog.requestedAtMs) ||
    !Array.isArray(catalog.imports) ||
    !Array.isArray(catalog.unresolved)
  ) {
    throw new Error('legacy physical worker migration catalog input is invalid')
  }
  return Object.freeze({
    version: 1,
    worker: parseWorker(value.worker),
    catalog: Object.freeze({
      migrationId: catalog.migrationId,
      authorityHostId: catalog.authorityHostId,
      requestedAtMs: Number(catalog.requestedAtMs),
      imports: Object.freeze(structuredClone(catalog.imports)),
      unresolved: Object.freeze(structuredClone(catalog.unresolved))
    })
  })
}

export function parseLegacyPhysicalWorkerMigrationBarrierRequest(
  value: Record<string, unknown>
): LegacyPhysicalWorkerMigrationBarrierRequest {
  assertAuthorityId(value.barrierId, 'legacy migration barrierId')
  if (value.version !== 1 || !nonNegativeInteger(value.expectedCatalogRevision)) {
    throw new Error('legacy physical worker migration barrier request is invalid')
  }
  return Object.freeze({
    version: 1,
    barrierId: value.barrierId,
    expectedCatalogRevision: Number(value.expectedCatalogRevision)
  })
}

export function parseLegacyPhysicalWorkerGcProtectionRequest(
  value: Record<string, unknown>
): LegacyPhysicalWorkerGcProtectionRequest {
  if (value.version !== 1) {
    throw new Error('legacy physical worker GC protection request is invalid')
  }
  return Object.freeze({ version: 1 })
}

export function parseLegacyPhysicalWorkerGcRequest(
  value: Record<string, unknown>
): LegacyPhysicalWorkerGcRequest {
  assertAuthorityId(value.barrierId, 'legacy GC barrierId')
  if (
    value.version !== 1 ||
    (value.relayDirectories !== undefined &&
      (!Array.isArray(value.relayDirectories) || value.relayDirectories.length > 256)) ||
    (value.evidencePaths !== undefined &&
      (!Array.isArray(value.evidencePaths) || value.evidencePaths.length > 1_024))
  ) {
    throw new Error('legacy physical worker GC request is invalid')
  }
  for (const path of [
    ...((value.relayDirectories as unknown[] | undefined) ?? []),
    ...((value.evidencePaths as unknown[] | undefined) ?? [])
  ]) {
    assertAuthorityStoragePath(path, 'legacy GC path')
  }
  return Object.freeze({
    version: 1,
    barrierId: value.barrierId
  })
}

function parseWorker(value: Record<string, unknown>): LegacyPhysicalWorkerDescriptor {
  for (const [field, selected] of [
    ['workerId', value.workerId],
    ['routeId', value.routeId],
    ['ownerIncarnationId', value.ownerIncarnationId],
    ['buildId', value.buildId],
    ['clientInstanceId', value.clientInstanceId]
  ] as const) {
    assertAuthorityId(selected, `legacy physical worker ${field}`)
  }
  for (const [field, selected] of [
    ['relayDirectory', value.relayDirectory],
    ['publicCredentialFile', value.publicCredentialFile],
    ['privateCredentialFile', value.privateCredentialFile],
    ['privateStateDirectory', value.privateStateDirectory]
  ] as const) {
    assertAuthorityStoragePath(selected, `legacy physical worker ${field}`)
  }
  if (
    value.version !== 1 ||
    !isRecord(value.process) ||
    !isRecord(value.expectedEndpoint) ||
    !positiveInteger(value.process.pid) ||
    typeof value.process.birthMarker !== 'string' ||
    !positiveInteger(value.requestedSourceWindowSu)
  ) {
    throw new Error('legacy physical worker descriptor is invalid')
  }
  const base = {
    version: 1 as const,
    workerId: value.workerId as string,
    routeId: value.routeId as string,
    ownerIncarnationId: value.ownerIncarnationId as string,
    buildId: value.buildId as string,
    clientInstanceId: value.clientInstanceId as string,
    relayDirectory: value.relayDirectory as string,
    process: Object.freeze(structuredClone(value.process)) as TerminalLegacyProcessIdentity,
    expectedEndpoint: Object.freeze(
      structuredClone(value.expectedEndpoint)
    ) as TerminalLegacyEndpointIdentity,
    requestedSourceWindowSu: Number(value.requestedSourceWindowSu),
    publicCredentialFile: value.publicCredentialFile as string,
    privateCredentialFile: value.privateCredentialFile as string,
    privateStateDirectory: value.privateStateDirectory as string
  }
  if (value.platform === 'linux' || value.platform === 'darwin') {
    assertAuthorityStoragePath(value.publicSocketPath, 'legacy publicSocketPath')
    assertAuthorityStoragePath(value.privateSocketPath, 'legacy privateSocketPath')
    return Object.freeze({
      ...base,
      platform: value.platform,
      publicSocketPath: value.publicSocketPath,
      privateSocketPath: value.privateSocketPath
    })
  }
  if (value.platform !== 'win32') {
    throw new Error('legacy physical worker platform is invalid')
  }
  assertAuthorityStoragePath(value.pipeName, 'legacy pipeName')
  assertAuthorityStoragePath(value.activePipeMarkerPath, 'legacy activePipeMarkerPath')
  assertAuthorityStoragePath(
    value.privateActivePipeMarkerPath,
    'legacy privateActivePipeMarkerPath'
  )
  return Object.freeze({
    ...base,
    platform: 'win32',
    pipeName: value.pipeName,
    activePipeMarkerPath: value.activePipeMarkerPath,
    privateActivePipeMarkerPath: value.privateActivePipeMarkerPath
  })
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0
}
