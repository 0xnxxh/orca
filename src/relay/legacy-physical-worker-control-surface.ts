import type { TerminalLegacyGcProtection } from '../shared/terminal-legacy-cutover'
import type { RelayDispatcher, RequestContext } from './dispatcher'
import type {
  LegacyPhysicalWorkerInspection,
  LegacyPhysicalWorkerMigrationResult
} from './legacy-physical-worker-authority-host'
import {
  LEGACY_PHYSICAL_WORKER_GC_METHOD,
  LEGACY_PHYSICAL_WORKER_GC_PROTECTION_METHOD,
  LEGACY_PHYSICAL_WORKER_INSPECT_METHOD,
  LEGACY_PHYSICAL_WORKER_MIGRATE_METHOD,
  LEGACY_PHYSICAL_WORKER_MIGRATION_BARRIER_METHOD,
  parseLegacyPhysicalWorkerGcProtectionRequest,
  parseLegacyPhysicalWorkerGcRequest,
  parseLegacyPhysicalWorkerInspectRequest,
  parseLegacyPhysicalWorkerMigrateRequest,
  parseLegacyPhysicalWorkerMigrationBarrierRequest,
  type LegacyPhysicalWorkerDescriptor,
  type LegacyPhysicalWorkerMigrationCatalogInput
} from './legacy-physical-worker-control-protocol'
import { assertAuthenticatedTerminalAuthorityControl } from './terminal-authority-control-protocol'

export type LegacyPhysicalWorkerControlHost = Readonly<{
  inspect: (descriptor: LegacyPhysicalWorkerDescriptor) => Promise<LegacyPhysicalWorkerInspection>
  migrate: (input: {
    descriptor: LegacyPhysicalWorkerDescriptor
    catalog: LegacyPhysicalWorkerMigrationCatalogInput
  }) => Promise<LegacyPhysicalWorkerMigrationResult>
  gcProtection: () => TerminalLegacyGcProtection
  catalogRevision: () => number
}>

export type LegacyPhysicalWorkerControlGc = Readonly<{
  commitBarrier: (input: { barrierId: string; expectedCatalogRevision: number }) => Promise<unknown>
  collect: (input: { barrierId: string }) => Promise<unknown>
}>

export type LegacyPhysicalWorkerControlDispatcher = Pick<RelayDispatcher, 'onRequest'>

export function registerLegacyPhysicalWorkerControlSurface(input: {
  dispatcher: LegacyPhysicalWorkerControlDispatcher
  host: LegacyPhysicalWorkerControlHost
  gc: LegacyPhysicalWorkerControlGc
  hasActiveClient: (clientId: number) => boolean
  protection?: () => TerminalLegacyGcProtection
}): void {
  const protection = input.protection ?? (() => input.host.gcProtection())
  input.dispatcher.onRequest(LEGACY_PHYSICAL_WORKER_INSPECT_METHOD, async (params, context) => {
    assertPreOpenControl(context, input.hasActiveClient)
    const request = parseLegacyPhysicalWorkerInspectRequest(params)
    return await input.host.inspect(request.worker)
  })
  input.dispatcher.onRequest(LEGACY_PHYSICAL_WORKER_MIGRATE_METHOD, async (params, context) => {
    assertPreOpenControl(context, input.hasActiveClient)
    const request = parseLegacyPhysicalWorkerMigrateRequest(params)
    return await input.host.migrate({ descriptor: request.worker, catalog: request.catalog })
  })
  input.dispatcher.onRequest(
    LEGACY_PHYSICAL_WORKER_GC_PROTECTION_METHOD,
    async (params, context) => {
      assertPreOpenControl(context, input.hasActiveClient)
      parseLegacyPhysicalWorkerGcProtectionRequest(params)
      return Object.freeze({
        catalogRevision: input.host.catalogRevision(),
        protection: protection()
      })
    }
  )
  input.dispatcher.onRequest(
    LEGACY_PHYSICAL_WORKER_MIGRATION_BARRIER_METHOD,
    async (params, context) => {
      assertPreOpenControl(context, input.hasActiveClient)
      const request = parseLegacyPhysicalWorkerMigrationBarrierRequest(params)
      return await input.gc.commitBarrier(request)
    }
  )
  input.dispatcher.onRequest(LEGACY_PHYSICAL_WORKER_GC_METHOD, async (params, context) => {
    assertPreOpenControl(context, input.hasActiveClient)
    const request = parseLegacyPhysicalWorkerGcRequest(params)
    return await input.gc.collect(request)
  })
}

function assertPreOpenControl(
  context: RequestContext,
  hasActiveClient: (clientId: number) => boolean
): void {
  assertAuthenticatedTerminalAuthorityControl(context)
  if (hasActiveClient(context.clientId)) {
    throw new Error('legacy_physical_worker_control_requires_pre_open_client')
  }
}
