import type {
  TerminalAuthorityAppPaneProjection,
  TerminalAuthorityAppProjectionRowIdentity
} from '../../shared/terminal-authority-app-projection'
import type {
  TerminalAuthorityNamespace,
  TerminalPaneGeneration
} from '../../shared/terminal-session-authority-identity'
import SyncDatabase from '../sqlite/sync-database'
import {
  parseTerminalAuthorityAppProjectionDatabaseRow,
  serializeTerminalAuthorityAppProjectionRow,
  type TerminalAuthorityAppProjectionDatabaseRow
} from './terminal-authority-app-projection-row-storage'

export class TerminalAuthorityAppProjectionDatabase {
  private readonly database: SyncDatabase

  constructor(databasePath: string) {
    this.database = new SyncDatabase(databasePath)
    this.database.pragma('journal_mode = WAL')
    this.database.pragma('synchronous = FULL')
    this.database.pragma('busy_timeout = 5000')
    this.database.exec(schemaSql())
  }

  begin(): void {
    this.database.exec('BEGIN IMMEDIATE')
  }

  rollback(): void {
    this.database.exec('ROLLBACK')
  }

  commit(beforeCommit: () => void): void {
    beforeCommit()
    this.database.exec('COMMIT')
  }

  close(): void {
    this.database.pragma('wal_checkpoint(TRUNCATE)')
    this.database.close()
  }

  rowsForConsumer(consumerId: string): readonly TerminalAuthorityAppPaneProjection[] {
    return (
      this.database
        .prepare(
          `SELECT * FROM terminal_authority_app_projection WHERE consumer_id = ?
         ORDER BY authority_host_id, namespace_id, pane_key, pane_generation_id`
        )
        .all(consumerId) as TerminalAuthorityAppProjectionDatabaseRow[]
    ).map(parseTerminalAuthorityAppProjectionDatabaseRow)
  }

  namespaceRows(
    consumerId: string,
    namespace: TerminalAuthorityNamespace
  ): readonly TerminalAuthorityAppPaneProjection[] {
    return (
      this.database
        .prepare(
          `SELECT * FROM terminal_authority_app_projection
         WHERE consumer_id = ? AND authority_host_id = ? AND namespace_id = ?`
        )
        .all(
          consumerId,
          namespace.authorityHostId,
          namespace.namespaceId
        ) as TerminalAuthorityAppProjectionDatabaseRow[]
    ).map(parseTerminalAuthorityAppProjectionDatabaseRow)
  }

  allRows(): readonly TerminalAuthorityAppPaneProjection[] {
    return (
      this.database
        .prepare('SELECT * FROM terminal_authority_app_projection')
        .all() as TerminalAuthorityAppProjectionDatabaseRow[]
    ).map(parseTerminalAuthorityAppProjectionDatabaseRow)
  }

  readRow(
    consumerId: string,
    namespace: TerminalAuthorityNamespace,
    pane: TerminalPaneGeneration
  ): TerminalAuthorityAppPaneProjection | null {
    const row = this.database
      .prepare(
        `SELECT * FROM terminal_authority_app_projection
         WHERE consumer_id = ? AND authority_host_id = ? AND namespace_id = ?
           AND pane_key = ? AND pane_generation_id = ?`
      )
      .get(
        consumerId,
        namespace.authorityHostId,
        namespace.namespaceId,
        pane.paneKey,
        pane.paneGenerationId
      ) as TerminalAuthorityAppProjectionDatabaseRow | undefined
    return row ? parseTerminalAuthorityAppProjectionDatabaseRow(row) : null
  }

  writeRow(row: TerminalAuthorityAppPaneProjection): void {
    this.database
      .prepare(
        `INSERT INTO terminal_authority_app_projection (
           consumer_id, authority_host_id, namespace_id, pane_key, pane_generation_id, projection_json
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (consumer_id, authority_host_id, namespace_id, pane_key, pane_generation_id)
         DO UPDATE SET projection_json = excluded.projection_json`
      )
      .run(
        row.consumerId,
        row.namespace.authorityHostId,
        row.namespace.namespaceId,
        row.pane.paneKey,
        row.pane.paneGenerationId,
        serializeTerminalAuthorityAppProjectionRow(row)
      )
  }

  deleteRow(identity: TerminalAuthorityAppProjectionRowIdentity): void {
    this.database
      .prepare(
        `DELETE FROM terminal_authority_app_projection
         WHERE consumer_id = ? AND authority_host_id = ? AND namespace_id = ?
           AND pane_key = ? AND pane_generation_id = ?`
      )
      .run(
        identity.consumerId,
        identity.namespace.authorityHostId,
        identity.namespace.namespaceId,
        identity.pane.paneKey,
        identity.pane.paneGenerationId
      )
  }

  readInitializationRevision(
    consumerId: string,
    namespace: TerminalAuthorityNamespace
  ): number | null {
    const row = this.database
      .prepare(
        `SELECT authority_revision FROM terminal_authority_app_projection_namespace
         WHERE consumer_id = ? AND authority_host_id = ? AND namespace_id = ?`
      )
      .get(consumerId, namespace.authorityHostId, namespace.namespaceId) as
      | { authority_revision: number }
      | undefined
    return row?.authority_revision ?? null
  }

  writeInitializationRevision(
    consumerId: string,
    namespace: TerminalAuthorityNamespace,
    authorityRevision: number
  ): void {
    this.database
      .prepare(
        `INSERT INTO terminal_authority_app_projection_namespace (
           consumer_id, authority_host_id, namespace_id, authority_revision
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT (consumer_id, authority_host_id, namespace_id)
         DO UPDATE SET authority_revision = excluded.authority_revision`
      )
      .run(consumerId, namespace.authorityHostId, namespace.namespaceId, authorityRevision)
  }

  rowCount(): number {
    const row = this.database
      .prepare('SELECT COUNT(*) AS count FROM terminal_authority_app_projection')
      .get() as { count: number }
    return row.count
  }
}

function schemaSql(): string {
  return `
    CREATE TABLE IF NOT EXISTS terminal_authority_app_projection (
      consumer_id TEXT NOT NULL, authority_host_id TEXT NOT NULL, namespace_id TEXT NOT NULL,
      pane_key TEXT NOT NULL, pane_generation_id TEXT NOT NULL, projection_json TEXT NOT NULL,
      PRIMARY KEY (consumer_id, authority_host_id, namespace_id, pane_key, pane_generation_id)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS terminal_authority_app_projection_namespace (
      consumer_id TEXT NOT NULL, authority_host_id TEXT NOT NULL, namespace_id TEXT NOT NULL,
      authority_revision INTEGER NOT NULL,
      PRIMARY KEY (consumer_id, authority_host_id, namespace_id)
    ) WITHOUT ROWID;`
}
