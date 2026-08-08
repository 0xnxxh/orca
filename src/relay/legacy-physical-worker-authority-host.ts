import { isDeepStrictEqual } from 'node:util'
import { assertTerminalLegacyMigrationImportRequest } from '../shared/terminal-legacy-cutover-request-validation'
import type {
  TerminalLegacyCutoverProof,
  TerminalLegacyGcProtection,
  TerminalLegacyMigrationImportRequest,
  TerminalLegacyMigrationReceipt,
  TerminalLegacyWorkerRoute
} from '../shared/terminal-legacy-cutover'
import type { TerminalLegacyWorkerLiveRegistration } from '../main/session-authority/terminal-legacy-worker-live-registration'
import type { TerminalLegacyPhysicalWorkerAuthorityEntry } from '../main/session-authority/terminal-session-authority-legacy-projection'
import type { LegacyPhysicalWorkerDescriptor } from './legacy-physical-worker-control-protocol'
import type { LegacyPhysicalWorkerCutoverSession } from './legacy-physical-worker-cutover-session'
import {
  inspectLegacyPhysicalWorker,
  restoreLegacyPhysicalWorker
} from './legacy-physical-worker-cutover-session'
import type { LegacyPhysicalWorkerRegistry } from './legacy-physical-worker-registry'

const DEFAULT_MAX_PENDING_CUTOVERS = 16

export type LegacyPhysicalWorkerMigrationAuthority = Readonly<{
  importMigration: (
    request: TerminalLegacyMigrationImportRequest
  ) => Promise<Readonly<{ receipt: TerminalLegacyMigrationReceipt; duplicate: boolean }>>
  activateWorker: (registration: TerminalLegacyWorkerLiveRegistration) => Promise<boolean>
  deactivateWorker: (routeId: string, registrationId: string) => Promise<boolean>
  gcProtection: () => TerminalLegacyGcProtection
  physicalWorkerEntries: () => readonly TerminalLegacyPhysicalWorkerAuthorityEntry[]
  projection: () => Readonly<{ revision: number }>
}>

export type LegacyPhysicalWorkerInspection = Readonly<{
  workerId: string
  routeId: string
  buildId: string
  ptys: LegacyPhysicalWorkerCutoverSession['inventory']
}>

export type LegacyPhysicalWorkerMigrationResult = Readonly<{
  receipt: TerminalLegacyMigrationReceipt
  duplicate: boolean
  inspection: LegacyPhysicalWorkerInspection
  gcProtection: TerminalLegacyGcProtection
}>

export type LegacyPhysicalWorkerAuthorityRegistry = Readonly<{
  register: LegacyPhysicalWorkerRegistry['register']
}>

export type LegacyPhysicalWorkerAuthorityHostOperations = Readonly<{
  inspect: typeof inspectLegacyPhysicalWorker
  restore: typeof restoreLegacyPhysicalWorker
}>

type PendingCutover = Readonly<{
  descriptor: LegacyPhysicalWorkerDescriptor
  session: LegacyPhysicalWorkerCutoverSession
}>

export class LegacyPhysicalWorkerAuthorityHost {
  private readonly pending = new Map<string, Promise<PendingCutover>>()
  private readonly activeProtection = new Map<string, TerminalLegacyGcProtection>()
  private readonly pendingProtection = new Map<string, TerminalLegacyGcProtection>()
  private readonly deactivationListeners = new Map<string, () => void>()
  private readonly maxPendingCutovers: number
  private disposed = false

  constructor(
    private readonly registry: LegacyPhysicalWorkerAuthorityRegistry,
    private readonly authority: LegacyPhysicalWorkerMigrationAuthority,
    limits: Readonly<{ maxPendingCutovers?: number }> = {},
    private readonly operations: LegacyPhysicalWorkerAuthorityHostOperations = {
      inspect: inspectLegacyPhysicalWorker,
      restore: restoreLegacyPhysicalWorker
    }
  ) {
    this.maxPendingCutovers = positiveLimit(limits.maxPendingCutovers, DEFAULT_MAX_PENDING_CUTOVERS)
  }

  async inspect(
    descriptor: LegacyPhysicalWorkerDescriptor
  ): Promise<LegacyPhysicalWorkerInspection> {
    const pending = await this.pendingCutover(descriptor)
    return inspection(pending.session)
  }

  async migrate(input: {
    descriptor: LegacyPhysicalWorkerDescriptor
    catalog: Readonly<{
      migrationId: string
      authorityHostId: string
      requestedAtMs: number
      imports: TerminalLegacyMigrationImportRequest['imports']
      unresolved: TerminalLegacyMigrationImportRequest['unresolved']
    }>
  }): Promise<LegacyPhysicalWorkerMigrationResult> {
    this.assertOpen()
    const pending = await this.pendingCutover(input.descriptor)
    const preserved = await pending.session.cutover()
    const registration = await this.registry.register(preserved.registration)
    if (registration.status !== 'registered') {
      throw new Error(`legacy physical worker registration failed: ${registration.status}`)
    }
    this.activeProtection.set(preserved.route.routeId, preserved.route.gcProtection)
    const request = Object.freeze({
      version: 1 as const,
      mode: 'cutover' as const,
      migrationId: input.catalog.migrationId,
      authorityHostId: input.catalog.authorityHostId,
      requestedAtMs: input.catalog.requestedAtMs,
      workerRoute: preserved.route,
      cutover: preserved.proof,
      imports: input.catalog.imports,
      unresolved: input.catalog.unresolved
    })
    assertTerminalLegacyMigrationImportRequest(request)
    const committed = await this.authority.importMigration(request)
    await this.activateRegistration(preserved.route, preserved.proof, preserved.registration.client)
    this.pending.delete(input.descriptor.routeId)
    this.pendingProtection.delete(input.descriptor.routeId)
    return Object.freeze({
      ...committed,
      inspection: inspection(pending.session),
      gcProtection: this.gcProtection()
    })
  }

  async restoreAuthorityWorkers(): Promise<
    readonly Readonly<{
      routeId: string
      status: 'restored' | 'unreachable'
      reason?: string
    }>[]
  > {
    this.assertOpen()
    return Object.freeze(
      await Promise.all(
        this.authority.physicalWorkerEntries().map(async (entry) => {
          this.activeProtection.set(entry.route.routeId, entry.route.gcProtection)
          try {
            const registration = await this.operations.restore({
              route: entry.route,
              proof: entry.cutover
            })
            const registered = await this.registry.register(registration)
            if (registered.status !== 'registered') {
              throw new Error(`registry-${registered.status}`)
            }
            await this.activateRegistration(entry.route, entry.cutover, registration.client)
            return Object.freeze({
              routeId: entry.route.routeId,
              status: 'restored' as const
            })
          } catch (error) {
            return Object.freeze({
              routeId: entry.route.routeId,
              status: 'unreachable' as const,
              reason: error instanceof Error ? error.message : String(error)
            })
          }
        })
      )
    )
  }

  gcProtection(): TerminalLegacyGcProtection {
    const authority = this.authority.gcProtection()
    const relayDirectories = new Set(authority.relayDirectories)
    const evidencePaths = new Set(authority.evidencePaths)
    for (const protection of this.activeProtection.values()) {
      protection.relayDirectories.forEach((path) => relayDirectories.add(path))
      protection.evidencePaths.forEach((path) => evidencePaths.add(path))
    }
    for (const protection of this.pendingProtection.values()) {
      protection.relayDirectories.forEach((path) => relayDirectories.add(path))
      protection.evidencePaths.forEach((path) => evidencePaths.add(path))
    }
    return Object.freeze({
      relayDirectories: Object.freeze([...relayDirectories].sort()),
      evidencePaths: Object.freeze([...evidencePaths].sort())
    })
  }

  gcEligible(): TerminalLegacyGcProtection {
    const relayDirectories = new Set<string>()
    const evidencePaths = new Set<string>()
    for (const entry of this.authority.physicalWorkerEntries()) {
      entry.route.gcProtection.relayDirectories.forEach((path) => relayDirectories.add(path))
      entry.route.gcProtection.evidencePaths.forEach((path) => evidencePaths.add(path))
    }
    return Object.freeze({
      relayDirectories: Object.freeze([...relayDirectories].sort()),
      evidencePaths: Object.freeze([...evidencePaths].sort())
    })
  }

  catalogRevision(): number {
    return this.authority.projection().revision
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    for (const remove of this.deactivationListeners.values()) {
      remove()
    }
    this.deactivationListeners.clear()
    for (const pending of this.pending.values()) {
      void pending.then(({ session }) => session.client.close()).catch(() => {})
    }
    this.pending.clear()
    this.pendingProtection.clear()
  }

  private pendingCutover(descriptor: LegacyPhysicalWorkerDescriptor): Promise<PendingCutover> {
    this.assertOpen()
    const current = this.pending.get(descriptor.routeId)
    if (current) {
      return current.then((pending) => {
        if (!isDeepStrictEqual(pending.descriptor, descriptor)) {
          throw new Error('legacy physical worker route ID was reused')
        }
        return pending
      })
    }
    if (this.pending.size >= this.maxPendingCutovers) {
      throw new Error('legacy physical worker cutover capacity exceeded')
    }
    const opened = this.operations
      .inspect(descriptor)
      .then((session) => Object.freeze({ descriptor: structuredClone(descriptor), session }))
    this.pending.set(descriptor.routeId, opened)
    this.pendingProtection.set(
      descriptor.routeId,
      Object.freeze({
        relayDirectories: Object.freeze([descriptor.relayDirectory]),
        evidencePaths: Object.freeze([...descriptorEvidencePaths(descriptor)].sort())
      })
    )
    opened.catch(() => {
      if (this.pending.get(descriptor.routeId) === opened) {
        this.pending.delete(descriptor.routeId)
        this.pendingProtection.delete(descriptor.routeId)
      }
    })
    return opened
  }

  private async activateRegistration(
    route: TerminalLegacyWorkerRoute,
    cutover: TerminalLegacyCutoverProof,
    client: LegacyPhysicalWorkerCutoverSession['client']
  ): Promise<void> {
    const registrationId = `${route.routeId}:${client.brokerConnectionIdentity}`
    await this.authority.activateWorker({
      registrationId,
      routeId: route.routeId,
      workerId: route.workerId,
      ownerIncarnationId: route.ownerIncarnationId,
      buildId: route.buildId,
      brokerConnectionIdentity: client.brokerConnectionIdentity,
      process: route.process,
      endpoint: cutover.endpointIdentity
    })
    this.deactivationListeners.get(route.routeId)?.()
    const remove = client.onClose(() => {
      if (this.deactivationListeners.get(route.routeId) !== remove) {
        return
      }
      this.deactivationListeners.delete(route.routeId)
      this.activeProtection.delete(route.routeId)
      void this.authority.deactivateWorker(route.routeId, registrationId).catch(() => {})
    })
    this.deactivationListeners.set(route.routeId, remove)
  }

  private assertOpen(): void {
    if (this.disposed) {
      throw new Error('legacy physical worker authority host is disposed')
    }
  }
}

function inspection(session: LegacyPhysicalWorkerCutoverSession): LegacyPhysicalWorkerInspection {
  return Object.freeze({
    workerId: session.descriptor.workerId,
    routeId: session.descriptor.routeId,
    buildId: session.descriptor.buildId,
    ptys: Object.freeze(structuredClone(session.inventory))
  })
}

function descriptorEvidencePaths(descriptor: LegacyPhysicalWorkerDescriptor): readonly string[] {
  return descriptor.platform === 'win32'
    ? [
        descriptor.pipeName,
        descriptor.activePipeMarkerPath,
        descriptor.privateActivePipeMarkerPath,
        descriptor.publicCredentialFile,
        descriptor.privateCredentialFile,
        descriptor.privateStateDirectory
      ]
    : [
        descriptor.publicSocketPath,
        descriptor.privateSocketPath,
        descriptor.publicCredentialFile,
        descriptor.privateCredentialFile,
        descriptor.privateStateDirectory
      ]
}

function positiveLimit(value: number | undefined, fallback: number): number {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > 256) {
    throw new Error('legacy physical worker cutover limit is invalid')
  }
  return selected
}
