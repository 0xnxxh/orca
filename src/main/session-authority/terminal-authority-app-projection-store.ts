import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import {
  TERMINAL_AUTHORITY_APP_PROJECTION_MAX_ROWS,
  terminalAuthorityAppProjectionRowKey,
  type TerminalAuthorityAppBellClearRequest,
  type TerminalAuthorityAppProjectionChange,
  type TerminalAuthorityAppPaneProjection
} from '../../shared/terminal-authority-app-projection'
import {
  assertAuthorityId,
  assertAuthorityStoragePath,
  type TerminalPaneGeneration
} from '../../shared/terminal-session-authority-identity'
import type {
  TerminalAuthorityNamespaceOutcomeBoundary,
  TerminalAuthorityNamespaceOutcomePublication
} from '../../shared/terminal-session-authority-consumer-transport'
import {
  reduceTerminalAuthorityAppProjection,
  settleTerminalAuthorityCommandCodeProjections,
  terminalAuthorityAppPrVerificationsDue
} from './terminal-authority-app-projection-reducer'
import { TerminalAuthorityAppProjectionDatabase } from './terminal-authority-app-projection-database'
import {
  assertTerminalAuthorityAppProjectionPublicationPage,
  emptyTerminalAuthorityAppProjectionChange,
  requireTerminalAuthorityAppBoundaryProjection,
  sameTerminalAuthorityAppEvent,
  terminalAuthorityAppProjectionLimit
} from './terminal-authority-app-projection-transaction-validation'
import { reconcileTerminalAuthorityAppProjectionSnapshot } from './terminal-authority-app-projection-snapshot'

export const TERMINAL_AUTHORITY_APP_PROJECTION_DATABASE_FILE =
  'terminal-authority-app-projection.sqlite'

export type TerminalAuthorityAppProjectionStoreOptions = Readonly<{
  directory: string
  maxRows?: number
  now?: () => number
  databasePath?: ':memory:'
  beforeCommit?: () => void
}>

export class TerminalAuthorityAppProjectionStore {
  private rowCountValue: number
  private writeTransactions = 0
  private writtenRows = 0

  private constructor(
    private readonly storage: TerminalAuthorityAppProjectionDatabase,
    private readonly maxRows: number,
    private readonly now: () => number,
    private readonly beforeCommit: () => void
  ) {
    this.rowCountValue = storage.rowCount()
    if (this.rowCountValue > maxRows) {
      throw new Error('terminal authority app projection capacity exceeded')
    }
  }

  static async open(
    options: TerminalAuthorityAppProjectionStoreOptions
  ): Promise<TerminalAuthorityAppProjectionStore> {
    assertAuthorityStoragePath(options.directory, 'app projection directory')
    const directory = path.resolve(options.directory)
    await mkdir(directory, { recursive: true })
    return new TerminalAuthorityAppProjectionStore(
      new TerminalAuthorityAppProjectionDatabase(
        options.databasePath ??
          path.join(directory, TERMINAL_AUTHORITY_APP_PROJECTION_DATABASE_FILE)
      ),
      terminalAuthorityAppProjectionLimit(
        options.maxRows,
        TERMINAL_AUTHORITY_APP_PROJECTION_MAX_ROWS
      ),
      options.now ?? Date.now,
      options.beforeCommit ?? (() => {})
    )
  }

  apply(
    publication: TerminalAuthorityNamespaceOutcomePublication
  ): TerminalAuthorityAppProjectionChange {
    assertTerminalAuthorityAppProjectionPublicationPage(publication)
    const cached = new Map<string, TerminalAuthorityAppPaneProjection | null>()
    const original = new Map<string, TerminalAuthorityAppPaneProjection | null>()
    const changed = new Map<string, TerminalAuthorityAppPaneProjection>()
    const lookup = (
      consumerId: string,
      _outcome: TerminalAuthorityNamespaceOutcomePublication['outcome'],
      pane: TerminalPaneGeneration
    ): TerminalAuthorityAppPaneProjection | null => {
      const key = terminalAuthorityAppProjectionRowKey({
        consumerId,
        namespace: publication.namespace,
        pane
      })
      if (!cached.has(key)) {
        const row = this.storage.readRow(consumerId, publication.namespace, pane)
        cached.set(key, row)
        original.set(key, row)
      }
      return cached.get(key) ?? null
    }
    this.storage.begin()
    try {
      for (const outcome of publication.outcomes ?? [publication.outcome]) {
        for (const row of reduceTerminalAuthorityAppProjection(
          publication.consumer.consumerId,
          outcome,
          lookup,
          this.now()
        )) {
          const key = terminalAuthorityAppProjectionRowKey(row)
          cached.set(key, row)
          changed.set(key, row)
        }
      }
      if (changed.size === 0) {
        this.storage.rollback()
        return emptyTerminalAuthorityAppProjectionChange()
      }
      const inserted = [...changed.keys()].filter((key) => original.get(key) === null).length
      this.assertCapacity(this.rowCountValue + inserted)
      for (const row of changed.values()) {
        this.storage.writeRow(row)
      }
      this.commit()
      this.rowCountValue += inserted
      this.writtenRows += changed.size
      return Object.freeze({
        rows: Object.freeze([...changed.values()]),
        deleted: Object.freeze([])
      })
    } catch (error) {
      this.storage.rollback()
      throw error
    }
  }

  beginBoundary(
    boundary: TerminalAuthorityNamespaceOutcomeBoundary
  ): TerminalAuthorityAppProjectionChange {
    const projection = requireTerminalAuthorityAppBoundaryProjection(boundary)
    if (
      boundary.consumerStart === 'new-at-tail' &&
      boundary.acknowledgedSequence !== boundary.outcomeHighWatermark
    ) {
      throw new Error('terminal authority app projection new consumer did not start at tail')
    }
    if (boundary.acknowledgedSequence < boundary.outcomeHighWatermark) {
      const metadataRevision = this.storage.readInitializationRevision(
        boundary.consumer.consumerId,
        boundary.namespace
      )
      if (metadataRevision === null) {
        throw new Error('terminal authority app projection history is unavailable')
      }
      if (projection.revision < metadataRevision) {
        throw new Error('terminal authority app projection boundary regressed')
      }
      return emptyTerminalAuthorityAppProjectionChange()
    }
    return this.reconcileBoundarySnapshot(boundary, boundary.consumerStart === 'new-at-tail')
  }

  completeBoundary(
    boundary: TerminalAuthorityNamespaceOutcomeBoundary
  ): TerminalAuthorityAppProjectionChange {
    requireTerminalAuthorityAppBoundaryProjection(boundary)
    return this.reconcileBoundarySnapshot(boundary, false)
  }

  private reconcileBoundarySnapshot(
    boundary: TerminalAuthorityNamespaceOutcomeBoundary,
    allowInitialize: boolean
  ): TerminalAuthorityAppProjectionChange {
    const projection = requireTerminalAuthorityAppBoundaryProjection(boundary)
    this.storage.begin()
    try {
      const metadataRevision = this.storage.readInitializationRevision(
        boundary.consumer.consumerId,
        boundary.namespace
      )
      if (metadataRevision === null && boundary.acknowledgedSequence > 0 && !allowInitialize) {
        throw new Error('terminal authority app projection history is unavailable')
      }
      if (metadataRevision !== null && projection.revision < metadataRevision) {
        throw new Error('terminal authority app projection boundary regressed')
      }
      const current = this.storage.namespaceRows(boundary.consumer.consumerId, boundary.namespace)
      const change = reconcileTerminalAuthorityAppProjectionSnapshot(
        boundary.consumer.consumerId,
        projection,
        current,
        this.now()
      )
      const currentKeys = new Set(current.map(terminalAuthorityAppProjectionRowKey))
      const inserted = change.rows.filter(
        (row) => !currentKeys.has(terminalAuthorityAppProjectionRowKey(row))
      ).length
      this.assertCapacity(this.rowCountValue - change.deleted.length + inserted)
      const metadataChanged = metadataRevision === null || projection.revision > metadataRevision
      if (change.rows.length === 0 && change.deleted.length === 0 && !metadataChanged) {
        this.storage.rollback()
        return emptyTerminalAuthorityAppProjectionChange()
      }
      for (const identity of change.deleted) {
        this.storage.deleteRow(identity)
      }
      for (const row of change.rows) {
        this.storage.writeRow(row)
      }
      this.storage.writeInitializationRevision(
        boundary.consumer.consumerId,
        boundary.namespace,
        projection.revision
      )
      this.commit()
      this.rowCountValue += inserted - change.deleted.length
      this.writtenRows += change.rows.length + change.deleted.length
      return change
    } catch (error) {
      this.storage.rollback()
      throw error
    }
  }

  snapshot(consumerId: string): readonly TerminalAuthorityAppPaneProjection[] {
    assertAuthorityId(consumerId, 'app projection consumerId')
    return Object.freeze(this.storage.rowsForConsumer(consumerId))
  }

  snapshotAll(): readonly TerminalAuthorityAppPaneProjection[] {
    return Object.freeze(this.storage.allRows())
  }

  clearBell(
    request: TerminalAuthorityAppBellClearRequest
  ): TerminalAuthorityAppPaneProjection | null {
    this.storage.begin()
    try {
      const row = this.storage.readRow(request.consumerId, request.namespace, request.pane)
      const bell = row?.facts.bell
      if (!row || !bell || !sameTerminalAuthorityAppEvent(bell.event, request.expectedEvent)) {
        this.storage.rollback()
        return null
      }
      if (row.attention.pendingBellCount === 0) {
        this.storage.rollback()
        return row
      }
      const changed = Object.freeze({
        ...row,
        attention: Object.freeze({ ...row.attention, pendingBellCount: 0, updatedAt: this.now() }),
        status: Object.freeze({ ...row.status, attention: false, updatedAt: this.now() })
      })
      this.storage.writeRow(changed)
      this.commit()
      this.writtenRows += 1
      return changed
    } catch (error) {
      this.storage.rollback()
      throw error
    }
  }

  settleDueCommandCode(now = this.now()): readonly TerminalAuthorityAppPaneProjection[] {
    const changed = settleTerminalAuthorityCommandCodeProjections(this.storage.allRows(), now)
    if (changed.length === 0) {
      return Object.freeze([])
    }
    this.storage.begin()
    try {
      for (const row of changed) {
        this.storage.writeRow(row)
      }
      this.commit()
      this.writtenRows += changed.length
      return Object.freeze(changed)
    } catch (error) {
      this.storage.rollback()
      throw error
    }
  }

  duePrVerifications(now = this.now()): readonly TerminalAuthorityAppPaneProjection[] {
    return Object.freeze(terminalAuthorityAppPrVerificationsDue(this.storage.allRows(), now))
  }

  statistics(): Readonly<{ rows: number; writeTransactions: number; writtenRows: number }> {
    return Object.freeze({
      rows: this.rowCountValue,
      writeTransactions: this.writeTransactions,
      writtenRows: this.writtenRows
    })
  }

  close(): void {
    this.storage.close()
  }

  private assertCapacity(rows: number): void {
    if (rows > this.maxRows) {
      throw new Error('terminal authority app projection capacity exceeded')
    }
  }

  private commit(): void {
    this.storage.commit(this.beforeCommit)
    this.writeTransactions += 1
  }
}
