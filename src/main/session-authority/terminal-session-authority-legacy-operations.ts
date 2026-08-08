import type { TerminalLegacyMigrationImportRequest } from '../../shared/terminal-legacy-cutover'
import type { TerminalSessionAuthorityLegacyMigration as TerminalAuthorityLegacyMigrationRecord } from '../../shared/terminal-session-authority-mutation'
import type { TerminalSessionAuthorityState } from '../../shared/terminal-session-authority-state'
import type { TerminalAuthorityWriterAccess } from './terminal-session-authority-access'
import type {
  TerminalAuthorityLegacyMigrationAccess,
  TerminalSessionAuthorityLegacyMigration
} from './terminal-session-authority-legacy-migration'
import type { TerminalAuthorityLegacyProjectionSource } from './terminal-session-authority-legacy-projection'
import type { TerminalAuthorityLegacyWorkerAccess } from './terminal-session-authority-service-contract'

export type TerminalAuthorityAppliedLegacyMigration = Readonly<{
  migration: TerminalAuthorityLegacyMigrationRecord
  duplicate: boolean
}>

type TerminalAuthorityLegacyOperationsOptions = Readonly<{
  state: TerminalSessionAuthorityState
  migration: TerminalSessionAuthorityLegacyMigration
  enqueue: <T>(operation: () => Promise<T>) => Promise<T>
  assertWriter: (writer: TerminalAuthorityWriterAccess) => void
  assertAccepting: () => void
  publish: (reason: 'legacy-import' | 'owner-reachability') => void
}>

export class TerminalSessionAuthorityLegacyOperations {
  constructor(private readonly options: TerminalAuthorityLegacyOperationsOptions) {}

  apply(
    writer: TerminalAuthorityWriterAccess,
    unsafeRequest: TerminalLegacyMigrationImportRequest,
    reservation: TerminalAuthorityLegacyMigrationAccess
  ): Promise<TerminalAuthorityAppliedLegacyMigration> {
    const request = structuredClone(unsafeRequest)
    return this.options.enqueue(async () => {
      this.options.assertWriter(writer)
      const applied = await this.options.migration.apply(request, reservation)
      if (!applied.duplicate) {
        this.options.publish('legacy-import')
      }
      return applied
    })
  }

  reserve(
    writer: TerminalAuthorityWriterAccess,
    unsafeRequest: TerminalLegacyMigrationImportRequest,
    requestDigest: string,
    committedAtMs: number
  ): Promise<TerminalAuthorityLegacyMigrationAccess> {
    const request = structuredClone(unsafeRequest)
    return this.options.enqueue(async () => {
      this.options.assertWriter(writer)
      return this.options.migration.reserve(request, requestDigest, committedAtMs)
    })
  }

  finish(
    writer: TerminalAuthorityWriterAccess,
    access: TerminalAuthorityLegacyMigrationAccess
  ): Promise<void> {
    return this.options.enqueue(async () => {
      this.options.assertWriter(writer)
      this.options.migration.finish(access)
    })
  }

  setOwnerReachable(
    writer: TerminalAuthorityWriterAccess,
    access: TerminalAuthorityLegacyWorkerAccess,
    ownerIncarnationId: string,
    reachable: boolean
  ): Promise<void> {
    return this.options.enqueue(async () => {
      this.options.assertWriter(writer)
      if (this.options.migration.setOwnerReachable(access, ownerIncarnationId, reachable)) {
        this.options.publish('owner-reachability')
      }
    })
  }

  snapshot(): TerminalAuthorityLegacyProjectionSource {
    this.options.assertAccepting()
    return Object.freeze({
      revision: this.options.state.legacy.revision,
      migrations: this.options.state.legacy.migrationSnapshot(),
      recoveries: this.options.state.legacy.recoverySnapshot(),
      workerRoutes: this.options.state.legacy.workerRouteSnapshot()
    })
  }
}
