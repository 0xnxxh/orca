import { describe, expect, it, vi } from 'vitest'
import type { MethodHandler, RequestContext } from './dispatcher'
import type {
  LegacyPhysicalWorkerControlGc,
  LegacyPhysicalWorkerControlHost
} from './legacy-physical-worker-control-surface'
import { registerLegacyPhysicalWorkerControlSurface } from './legacy-physical-worker-control-surface'
import {
  LEGACY_PHYSICAL_WORKER_GC_METHOD,
  LEGACY_PHYSICAL_WORKER_GC_PROTECTION_METHOD,
  LEGACY_PHYSICAL_WORKER_INSPECT_METHOD,
  LEGACY_PHYSICAL_WORKER_MIGRATE_METHOD,
  LEGACY_PHYSICAL_WORKER_MIGRATION_BARRIER_METHOD,
  type LegacyPhysicalWorkerDescriptor
} from './legacy-physical-worker-control-protocol'

describe('legacy physical worker authority control surface', () => {
  it('admits only authenticated pre-open authority control', async () => {
    const harness = controlHarness()
    const inspect = harness.handler(LEGACY_PHYSICAL_WORKER_INSPECT_METHOD)

    await expect(
      inspect({ version: 1, worker: descriptor }, unauthenticatedContext)
    ).rejects.toThrow('terminal_authority_control_not_authenticated')
    harness.active = true
    await expect(inspect({ version: 1, worker: descriptor }, authenticatedContext)).rejects.toThrow(
      'legacy_physical_worker_control_requires_pre_open_client'
    )
    harness.active = false
    await expect(
      inspect({ version: 1, worker: descriptor }, authenticatedContext)
    ).resolves.toEqual(harness.inspection)
    expect(harness.host.inspect).toHaveBeenCalledWith(descriptor)
  })

  it('registers bounded migration, protection, barrier, and local GC requests', async () => {
    const harness = controlHarness()
    expect([...harness.handlers.keys()].sort()).toEqual(
      [
        LEGACY_PHYSICAL_WORKER_GC_METHOD,
        LEGACY_PHYSICAL_WORKER_GC_PROTECTION_METHOD,
        LEGACY_PHYSICAL_WORKER_INSPECT_METHOD,
        LEGACY_PHYSICAL_WORKER_MIGRATE_METHOD,
        LEGACY_PHYSICAL_WORKER_MIGRATION_BARRIER_METHOD
      ].sort()
    )

    await expect(
      harness.handler(LEGACY_PHYSICAL_WORKER_MIGRATE_METHOD)(
        {
          version: 1,
          worker: descriptor,
          catalog: {
            migrationId: 'migration-1',
            authorityHostId: 'authority-1',
            requestedAtMs: 1,
            imports: [],
            unresolved: []
          }
        },
        authenticatedContext
      )
    ).rejects.toThrow('migration stub reached')
    expect(harness.host.migrate).toHaveBeenCalledOnce()

    await expect(
      harness.handler(LEGACY_PHYSICAL_WORKER_GC_PROTECTION_METHOD)(
        { version: 1 },
        authenticatedContext
      )
    ).resolves.toEqual({ catalogRevision: 7, protection: harness.protection })
    await expect(
      harness.handler(LEGACY_PHYSICAL_WORKER_GC_PROTECTION_METHOD)(
        { version: 2 },
        authenticatedContext
      )
    ).rejects.toThrow('GC protection request is invalid')

    await harness.handler(LEGACY_PHYSICAL_WORKER_MIGRATION_BARRIER_METHOD)(
      { version: 1, barrierId: 'barrier-1', expectedCatalogRevision: 7 },
      authenticatedContext
    )
    expect(harness.gc.commitBarrier).toHaveBeenCalledWith({
      version: 1,
      barrierId: 'barrier-1',
      expectedCatalogRevision: 7
    })

    await harness.handler(LEGACY_PHYSICAL_WORKER_GC_METHOD)(
      {
        version: 1,
        barrierId: 'barrier-1',
        relayDirectories: ['/old-relay'],
        evidencePaths: ['/old-relay/socket']
      },
      authenticatedContext
    )
    expect(harness.gc.collect).toHaveBeenCalledWith({
      version: 1,
      barrierId: 'barrier-1'
    })
  })
})

function controlHarness() {
  const handlers = new Map<string, MethodHandler>()
  const inspection = Object.freeze({
    workerId: 'worker-1',
    routeId: 'route-1',
    buildId: 'build-1',
    ptys: Object.freeze([])
  })
  const protection = Object.freeze({
    relayDirectories: Object.freeze(['/protected-relay']),
    evidencePaths: Object.freeze(['/authority-state'])
  })
  const host: LegacyPhysicalWorkerControlHost = {
    inspect: vi.fn(async () => inspection),
    migrate: vi.fn(async () => {
      throw new Error('migration stub reached')
    }),
    gcProtection: () => protection,
    catalogRevision: () => 7
  }
  const gc: LegacyPhysicalWorkerControlGc = {
    commitBarrier: vi.fn(async (input) => input),
    collect: vi.fn(async (input) => input)
  }
  const harness = {
    handlers,
    host,
    gc,
    inspection,
    protection,
    active: false,
    handler(method: string): MethodHandler {
      const handler = handlers.get(method)
      if (!handler) {
        throw new Error(`missing handler ${method}`)
      }
      return handler
    }
  }
  registerLegacyPhysicalWorkerControlSurface({
    dispatcher: { onRequest: (method, handler) => void handlers.set(method, handler) },
    host,
    gc,
    hasActiveClient: () => harness.active,
    protection: () => protection
  })
  return harness
}

const authenticatedContext: RequestContext = Object.freeze({
  clientId: 4,
  isStale: () => false,
  sessionIdentity: Object.freeze({
    principal: 'terminal-authority:authority-1',
    authenticated: true,
    allowSessionOwner: true,
    authenticationKind: 'endpoint-credential'
  })
})

const unauthenticatedContext: RequestContext = Object.freeze({
  clientId: 4,
  isStale: () => false
})

const descriptor: LegacyPhysicalWorkerDescriptor = Object.freeze({
  version: 1,
  workerId: 'worker-1',
  routeId: 'route-1',
  ownerIncarnationId: 'owner-1',
  buildId: 'build-1',
  clientInstanceId: 'broker-1',
  relayDirectory: '/old-relay',
  process: Object.freeze({ pid: 12, birthMarker: 'birth-1' }),
  expectedEndpoint: Object.freeze({
    kind: 'unix-socket',
    device: '1',
    inode: '2',
    changedAtNs: '3'
  }),
  requestedSourceWindowSu: 1024,
  publicCredentialFile: '/old-relay/credential',
  privateCredentialFile: '/authority-state/credential',
  privateStateDirectory: '/authority-state',
  platform: 'linux',
  publicSocketPath: '/old-relay/relay.sock',
  privateSocketPath: '/authority-state/worker.sock'
})
