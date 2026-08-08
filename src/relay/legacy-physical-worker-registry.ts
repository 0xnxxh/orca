import type { PtySourceRecoveryRequest } from '../shared/pty-source-recovery-contract'
import type { LegacyPhysicalWorkerAttachIdentity } from './legacy-physical-worker-attach-router'
import type {
  LegacyPhysicalWorkerMutation,
  LegacyPhysicalWorkerPtyIdentity
} from './legacy-physical-worker-client'
import {
  inspectLegacyPhysicalWorkerRegistration,
  type LegacyPhysicalWorkerRegistration
} from './legacy-physical-worker-registration'
import {
  createLegacyPhysicalWorkerRegistrationRecord,
  legacyPhysicalWorkerRecordIsReachable,
  legacyPhysicalWorkerRegistrationHasPty,
  publicLegacyPhysicalWorkerRegistration,
  retireLegacyPhysicalWorkerRegistrationRecord,
  type LegacyPhysicalWorkerRegistrationRecord
} from './legacy-physical-worker-registration-record'
import { LegacyPhysicalWorkerLifecycleSignal } from './legacy-physical-worker-lifecycle-signal'
import type { LegacyPhysicalWorkerExactRoute } from './legacy-physical-worker-exact-route'
import { LegacyPhysicalWorkerRouteGeneration } from './legacy-physical-worker-route-generation'
import {
  MAX_LEGACY_PHYSICAL_WORKERS,
  assertLegacyPhysicalWorkerPreservation,
  assertLegacyPhysicalWorkerRegistryCapacity,
  type LegacyPhysicalWorkerLifecycleCounts,
  type LegacyPhysicalWorkerPreservation,
  type LegacyPhysicalWorkerPreservationResult,
  type LegacyPhysicalWorkerRegistrationResult
} from './legacy-physical-worker-registry-contract'

export type {
  LegacyPhysicalWorkerProcessProbe,
  LegacyPhysicalWorkerRegistration
} from './legacy-physical-worker-registration'
export * from './legacy-physical-worker-registry-contract'

export class LegacyPhysicalWorkerRegistry {
  private readonly records = new Map<string, LegacyPhysicalWorkerRegistrationRecord>()
  private readonly preservation = new Map<string, string>()
  private readonly lifecycleSignal = new LegacyPhysicalWorkerLifecycleSignal()
  private readonly routeGeneration = new LegacyPhysicalWorkerRouteGeneration()
  private disposed = false

  constructor(readonly capacity = MAX_LEGACY_PHYSICAL_WORKERS) {
    assertLegacyPhysicalWorkerRegistryCapacity(capacity)
  }

  get size(): number {
    return this.records.size
  }

  get activeWorkerCount(): number {
    return [...this.records.values()].filter((record) => record.reachable && record.client.isOpen())
      .length
  }

  get pendingWorkerCount(): number {
    return this.lifecycleHoldCount - this.activeWorkerCount
  }

  get lifecycleHoldCount(): number {
    return new Set([...this.records.keys(), ...this.preservation.keys()]).size
  }

  lifecycleCounts(): LegacyPhysicalWorkerLifecycleCounts {
    return Object.freeze({
      activeWorkerCount: this.activeWorkerCount,
      pendingWorkerCount: this.pendingWorkerCount,
      lifecycleHoldCount: this.lifecycleHoldCount
    })
  }

  preserve(obligation: LegacyPhysicalWorkerPreservation): LegacyPhysicalWorkerPreservationResult {
    this.assertOpen()
    assertLegacyPhysicalWorkerPreservation(obligation)
    const recordRoute = this.records.get(obligation.ownerIncarnationId)?.route.routeId
    const preservedRoute = this.preservation.get(obligation.ownerIncarnationId)
    const currentRoute = recordRoute ?? preservedRoute
    if (currentRoute && currentRoute !== obligation.routeId) {
      return Object.freeze({ status: 'conflict', routeId: currentRoute })
    }
    if (preservedRoute) {
      return Object.freeze({ status: 'preserved', alreadyPresent: true })
    }
    if (!recordRoute && this.lifecycleHoldCount >= this.capacity) {
      return Object.freeze({ status: 'capacity' })
    }
    this.preservation.set(obligation.ownerIncarnationId, obligation.routeId)
    this.lifecycleSignal.notify()
    return Object.freeze({ status: 'preserved', alreadyPresent: false })
  }

  releasePreservation(obligation: LegacyPhysicalWorkerPreservation): boolean {
    assertLegacyPhysicalWorkerPreservation(obligation)
    if (this.preservation.get(obligation.ownerIncarnationId) !== obligation.routeId) {
      return false
    }
    this.preservation.delete(obligation.ownerIncarnationId)
    this.lifecycleSignal.notify()
    return true
  }

  async register(
    registration: LegacyPhysicalWorkerRegistration
  ): Promise<LegacyPhysicalWorkerRegistrationResult> {
    this.assertOpen()
    const inspection = await inspectLegacyPhysicalWorkerRegistration(registration)
    if (inspection.unsupported) {
      return Object.freeze({ status: 'unsupported', reason: inspection.unsupported })
    }
    const key = registration.route.ownerIncarnationId
    const preservedRoute = this.preservation.get(key)
    if (preservedRoute && preservedRoute !== registration.route.routeId) {
      return Object.freeze({ status: 'conflict', routeId: preservedRoute })
    }
    const current = this.records.get(key)
    if (current) {
      if (current.route.routeId !== registration.route.routeId) {
        return Object.freeze({ status: 'conflict', routeId: current.route.routeId })
      }
      if (current.client === registration.client) {
        const changed = !current.reachable
        current.reachable = true
        current.ptyIdentities = inspection.inventory
        if (changed) {
          this.lifecycleSignal.notify()
        }
        return Object.freeze({ status: 'registered', replaced: false })
      }
      if (current.client.isOpen()) {
        return Object.freeze({ status: 'conflict', routeId: current.route.routeId })
      }
      this.detachRecord(key, current, false, false)
    } else if (!preservedRoute && this.lifecycleHoldCount >= this.capacity) {
      return Object.freeze({ status: 'capacity' })
    }
    const record = createLegacyPhysicalWorkerRegistrationRecord(
      registration,
      inspection.inventory,
      this.routeGeneration.mint(),
      (closed) => {
        if (this.records.get(key) === closed) {
          this.lifecycleSignal.notify()
        }
      }
    )
    this.records.set(key, record)
    this.lifecycleSignal.notify()
    if (!registration.client.isOpen()) {
      record.reachable = false
      return Object.freeze({ status: 'unsupported', reason: 'worker-connection-closed' })
    }
    return Object.freeze({ status: 'registered', replaced: current !== undefined })
  }

  async resolve(ownerIncarnationId: string): Promise<LegacyPhysicalWorkerRegistration | null> {
    const record = this.records.get(ownerIncarnationId)
    if (!record || !(await this.refreshRecordReachability(ownerIncarnationId, record))) {
      return null
    }
    return publicLegacyPhysicalWorkerRegistration(record)
  }

  async listReachable(): Promise<readonly LegacyPhysicalWorkerRegistration[]> {
    const entries = [...this.records.entries()]
    const reachable = await Promise.all(
      entries.map(async ([key, record]) => ({
        record,
        reachable: await this.refreshRecordReachability(key, record)
      }))
    )
    return Object.freeze(
      reachable
        .filter((entry) => entry.reachable)
        .map((entry) => publicLegacyPhysicalWorkerRegistration(entry.record))
    )
  }

  async attachPty(
    ownerIncarnationId: string,
    pty: LegacyPhysicalWorkerAttachIdentity,
    sourceRecovery?: PtySourceRecoveryRequest
  ): Promise<Record<string, unknown> | null> {
    const registration = await this.resolvePty(ownerIncarnationId, pty)
    return registration ? await registration.client.attach(pty, sourceRecovery) : null
  }

  async resolvePtyRegistration(
    ownerIncarnationId: string,
    pty: LegacyPhysicalWorkerPtyIdentity
  ): Promise<LegacyPhysicalWorkerRegistration | null> {
    return await this.resolvePty(ownerIncarnationId, pty)
  }

  async resolveExactPtyRoute(
    ownerIncarnationId: string,
    pty: LegacyPhysicalWorkerPtyIdentity
  ): Promise<LegacyPhysicalWorkerExactRoute | null> {
    const record = await this.resolveCachedPtyRecord(ownerIncarnationId, pty)
    if (!record) {
      return null
    }
    return Object.freeze({
      client: record.client,
      generation: record.routeGeneration,
      isCurrent: () =>
        this.records.get(ownerIncarnationId) === record &&
        !record.removed &&
        record.reachable &&
        record.client.isOpen()
    })
  }

  onLifecycleChanged(listener: () => void): () => void {
    this.assertOpen()
    return this.lifecycleSignal.subscribe(listener)
  }

  async dispatchPtyMutation(
    ownerIncarnationId: string,
    pty: LegacyPhysicalWorkerPtyIdentity,
    mutation: LegacyPhysicalWorkerMutation
  ): Promise<boolean> {
    const registration = await this.resolvePty(ownerIncarnationId, pty)
    return registration ? await registration.client.dispatchVerifiedMutation(pty, mutation) : false
  }

  reservesPhysicalPtyId(id: string): boolean {
    return [...this.records.values()].some(
      (record) =>
        record.reachable &&
        record.client.isOpen() &&
        record.ptyIdentities.some((pty) => pty.id === id)
    )
  }

  unregister(obligation: LegacyPhysicalWorkerPreservation): boolean {
    assertLegacyPhysicalWorkerPreservation(obligation)
    const record = this.records.get(obligation.ownerIncarnationId)
    if (!record || record.route.routeId !== obligation.routeId) {
      return false
    }
    this.detachRecord(obligation.ownerIncarnationId, record, true)
    return true
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    for (const [key, record] of this.records) {
      this.detachRecord(key, record, true, false)
    }
    this.preservation.clear()
    this.lifecycleSignal.notify()
    this.lifecycleSignal.clear()
  }

  private async resolvePty(
    ownerIncarnationId: string,
    pty: LegacyPhysicalWorkerPtyIdentity
  ): Promise<LegacyPhysicalWorkerRegistration | null> {
    const registration = await this.resolve(ownerIncarnationId)
    return registration && (await legacyPhysicalWorkerRegistrationHasPty(registration, pty))
      ? registration
      : null
  }

  private async resolveCachedPtyRecord(
    ownerIncarnationId: string,
    pty: LegacyPhysicalWorkerPtyIdentity
  ): Promise<LegacyPhysicalWorkerRegistrationRecord | null> {
    const record = this.records.get(ownerIncarnationId)
    if (!record || !(await this.refreshRecordReachability(ownerIncarnationId, record))) {
      return null
    }
    return record.ptyIdentities.some(
      (candidate) => candidate.id === pty.id && candidate.incarnationId === pty.incarnationId
    )
      ? record
      : null
  }

  private async refreshRecordReachability(
    key: string,
    record: LegacyPhysicalWorkerRegistrationRecord
  ): Promise<boolean> {
    const reachable = await legacyPhysicalWorkerRecordIsReachable(record)
    if (this.records.get(key) === record) {
      const changed = record.reachable !== reachable
      record.reachable = reachable
      if (changed) {
        this.lifecycleSignal.notify()
      }
    }
    return reachable
  }

  private detachRecord(
    key: string,
    record: LegacyPhysicalWorkerRegistrationRecord,
    close: boolean,
    notify = true
  ): void {
    if (record.removed || this.records.get(key) !== record) {
      return
    }
    this.records.delete(key)
    retireLegacyPhysicalWorkerRegistrationRecord(record, close)
    if (notify) {
      this.lifecycleSignal.notify()
    }
  }

  private assertOpen(): void {
    if (this.disposed) {
      throw new Error('legacy physical worker registry is disposed')
    }
  }
}
