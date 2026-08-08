import { randomUUID } from 'node:crypto'
import type { TerminalLegacyMigrationImportRequest } from '../../shared/terminal-legacy-cutover'
import {
  failTerminalSessionAuthority,
  type TerminalSessionAuthorityLegacyMigration as TerminalAuthorityLegacyMigrationRecord
} from '../../shared/terminal-session-authority-mutation'
import type { TerminalSessionAuthorityState } from '../../shared/terminal-session-authority-state'
import type { TerminalAuthorityMutationPersistence } from './terminal-session-authority-mutation-persistence'
import type { TerminalAuthorityLegacyWorkerAccess } from './terminal-session-authority-service-contract'

export type TerminalAuthorityLegacyMigrationAccess = Readonly<{
  role: 'legacy-migration'
  serviceInstanceId: string
  reservationId: string
  migrationId: string
  requestDigest: string
  committedAtMs: number
}>

export class TerminalSessionAuthorityLegacyMigration {
  private consumerClaimed = false
  private reservation: TerminalAuthorityLegacyMigrationAccess | null = null

  constructor(
    private readonly state: TerminalSessionAuthorityState,
    private readonly persistence: TerminalAuthorityMutationPersistence,
    private readonly serviceInstanceId: string,
    private readonly workerAccess: TerminalAuthorityLegacyWorkerAccess | undefined
  ) {}

  assertCanAdmitConsumer(): void {
    if (this.reservation) {
      failTerminalSessionAuthority('consumer-conflict', 'legacy migration is still committing')
    }
  }

  assertCanMutate(): void {
    if (this.reservation) {
      failTerminalSessionAuthority('writer-fenced', 'legacy migration is still committing')
    }
  }

  markConsumerClaimed(): void {
    this.consumerClaimed = true
  }

  reserve(
    request: TerminalLegacyMigrationImportRequest,
    requestDigest: string,
    committedAtMs: number
  ): TerminalAuthorityLegacyMigrationAccess {
    this.plan(request, requestDigest, committedAtMs)
    if (
      request.mode !== 'acknowledge' &&
      (this.consumerClaimed || this.state.hasConsumers) &&
      !this.state.legacy.migration(request.migrationId)
    ) {
      failTerminalSessionAuthority(
        'consumer-conflict',
        'legacy migration must finish before consumer admission'
      )
    }
    if (this.reservation) {
      failTerminalSessionAuthority('consumer-conflict', 'legacy migration is already reserved')
    }
    this.reservation = Object.freeze({
      role: 'legacy-migration',
      serviceInstanceId: this.serviceInstanceId,
      reservationId: randomUUID(),
      migrationId: request.migrationId,
      requestDigest,
      committedAtMs
    })
    return this.reservation
  }

  async apply(
    request: TerminalLegacyMigrationImportRequest,
    access: TerminalAuthorityLegacyMigrationAccess
  ): Promise<
    Readonly<{
      migration: TerminalAuthorityLegacyMigrationRecord
      duplicate: boolean
    }>
  > {
    this.assertReservation(access, request.migrationId)
    const planned = this.plan(request, access.requestDigest, access.committedAtMs)
    if (!planned.duplicate) {
      await this.persistence.append(
        Object.freeze({ kind: 'legacy-migration', migration: planned.migration })
      )
    }
    return Object.freeze({
      migration: structuredClone(planned.migration),
      duplicate: planned.duplicate
    })
  }

  finish(access: TerminalAuthorityLegacyMigrationAccess): void {
    this.assertReservation(access, access.migrationId)
    this.reservation = null
  }

  setOwnerReachable(
    access: TerminalAuthorityLegacyWorkerAccess,
    ownerIncarnationId: string,
    reachable: boolean
  ): boolean {
    if (access !== this.workerAccess) {
      failTerminalSessionAuthority('writer-fenced', 'legacy worker access is stale')
    }
    return this.state.setLegacyOwnerReachable(ownerIncarnationId, reachable)
  }

  private assertReservation(
    access: TerminalAuthorityLegacyMigrationAccess,
    migrationId: string
  ): void {
    if (
      access !== this.reservation ||
      access.serviceInstanceId !== this.serviceInstanceId ||
      access.migrationId !== migrationId
    ) {
      failTerminalSessionAuthority('writer-fenced', 'legacy migration reservation is stale')
    }
  }

  private plan(
    request: TerminalLegacyMigrationImportRequest,
    requestDigest: string,
    committedAtMs: number
  ): ReturnType<TerminalSessionAuthorityState['legacy']['plan']> {
    const planned = this.state.legacy.plan(
      request,
      requestDigest,
      committedAtMs,
      this.state.revision + 1
    )
    if (!planned.duplicate) {
      this.state.assertLegacyMigrationTopologyAllowed(planned.migration)
    }
    return planned
  }
}
