import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import { OrchestrationDb } from './db'
import { requiresWorkerTerminalReleaseReadiness } from './orchestration-worker-terminal-release-reader'

describe('orchestration required index readiness', () => {
  let tempDir: string | undefined

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  function createDatabase(): string {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-required-index-readiness-'))
    const dbPath = join(tempDir, 'orchestration.db')
    const db = new OrchestrationDb(dbPath)
    db.close()
    return dbPath
  }

  function expectFullLeadingIndex(
    dbPath: string,
    table: string,
    indexName: string,
    leadingColumn: string
  ): void {
    const db = new SyncDatabase(dbPath, { readonly: true, fileMustExist: true })
    try {
      const index = (
        db.prepare(`PRAGMA index_list(${table})`).all() as {
          name?: string
          partial?: number
          unique?: number
        }[]
      ).find((row) => row.name === indexName)
      expect(index).toMatchObject({ partial: 0, unique: 0 })
      expect(db.prepare(`PRAGMA index_xinfo(${indexName})`).all()).toContainEqual(
        expect.objectContaining({ seqno: 0, name: leadingColumn, coll: 'BINARY', key: 1 })
      )
      expect(
        db
          .prepare(
            `EXPLAIN QUERY PLAN SELECT 1 FROM ${table} INDEXED BY ${indexName}
             WHERE ${leadingColumn} = ?`
          )
          .all('__probe__')
      ).toContainEqual(expect.objectContaining({ detail: expect.stringContaining('SEARCH') }))
    } finally {
      db.close()
    }
  }

  it.each([
    ['missing', ''],
    [
      'partial',
      "CREATE INDEX idx_worker_terminal_resources_release ON worker_terminal_resources(release_state) WHERE release_state = 'requested'"
    ],
    [
      'wrong-leading-column',
      'CREATE INDEX idx_worker_terminal_resources_release ON worker_terminal_resources(terminal_handle, release_state)'
    ],
    [
      'unique',
      'CREATE UNIQUE INDEX idx_worker_terminal_resources_release ON worker_terminal_resources(release_state)'
    ],
    [
      'non-binary',
      'CREATE INDEX idx_worker_terminal_resources_release ON worker_terminal_resources(release_state COLLATE NOCASE)'
    ]
  ])('opens readiness and repairs a %s release index', (_case, replacementSql) => {
    const dbPath = createDatabase()
    const raw = new SyncDatabase(dbPath)
    raw.exec('DROP INDEX idx_worker_terminal_resources_release')
    if (replacementSql) {
      raw.exec(replacementSql)
    }
    raw.exec(`
      INSERT INTO worker_terminal_resources (
        id, origin_dispatch_id, owner_dispatch_id, terminal_handle,
        ownership_state, release_state
      ) VALUES ('wtr_backlog', 'dispatch_backlog', 'dispatch_backlog', 'term_backlog',
                'owned', 'requested')
    `)
    raw.close()

    expect(requiresWorkerTerminalReleaseReadiness(dbPath)).toBe(true)
    const ready = new OrchestrationDb(dbPath)
    ready.close()
    expectFullLeadingIndex(
      dbPath,
      'worker_terminal_resources',
      'idx_worker_terminal_resources_release',
      'release_state'
    )
  })

  it.each([
    [
      'partial',
      'CREATE INDEX idx_dispatch_task ON dispatch_contexts(task_id) WHERE assignee_handle IS NOT NULL'
    ],
    [
      'wrong-leading-column',
      'CREATE INDEX idx_dispatch_task ON dispatch_contexts(assignee_handle, task_id)'
    ],
    ['unique', 'CREATE UNIQUE INDEX idx_dispatch_task ON dispatch_contexts(task_id)'],
    ['non-binary', 'CREATE INDEX idx_dispatch_task ON dispatch_contexts(task_id COLLATE NOCASE)']
  ])('repairs a %s dispatch index at full readiness', (_case, replacementSql) => {
    const dbPath = createDatabase()
    const raw = new SyncDatabase(dbPath)
    raw.exec('DROP INDEX idx_dispatch_task')
    raw.exec(replacementSql)
    raw.close()

    const ready = new OrchestrationDb(dbPath)
    ready.close()
    expectFullLeadingIndex(dbPath, 'dispatch_contexts', 'idx_dispatch_task', 'task_id')
  })

  it('rejects a future schema without mutating its objects', () => {
    const dbPath = createDatabase()
    const raw = new SyncDatabase(dbPath)
    raw.exec('DROP INDEX idx_dispatch_task')
    raw.exec(`
      CREATE INDEX idx_dispatch_task
        ON dispatch_contexts(task_id) WHERE assignee_handle IS NOT NULL;
      DROP TRIGGER trg_messages_route_coordinator_mail;
      CREATE TRIGGER trg_messages_route_coordinator_mail
        AFTER INSERT ON messages BEGIN SELECT NEW.sequence; END;
    `)
    raw.pragma('user_version = 29')
    raw.close()
    const before = readFileSync(dbPath)

    expect(() => new OrchestrationDb(dbPath)).toThrow(
      'Orchestration schema 29 is newer than supported version 28.'
    )
    expect(readFileSync(dbPath)).toEqual(before)
    const inspection = new SyncDatabase(dbPath, { readonly: true, fileMustExist: true })
    try {
      expect(
        inspection
          .prepare('PRAGMA index_list(dispatch_contexts)')
          .all()
          .find((row) => (row as { name?: string }).name === 'idx_dispatch_task')
      ).toMatchObject({ partial: 1 })
      expect(
        inspection
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
          .get('trg_messages_route_coordinator_mail')
      ).toEqual({
        sql: 'CREATE TRIGGER trg_messages_route_coordinator_mail\n        AFTER INSERT ON messages BEGIN SELECT NEW.sequence; END'
      })
      expect(inspection.pragma('user_version', { simple: true })).toBe(29)
    } finally {
      inspection.close()
    }
  })

  it('defers malformed release indexes owned by a future schema', () => {
    const dbPath = createDatabase()
    const raw = new SyncDatabase(dbPath)
    raw.exec('DROP INDEX idx_worker_terminal_resources_release')
    raw.exec(
      `CREATE INDEX idx_worker_terminal_resources_release
       ON worker_terminal_resources(release_state COLLATE NOCASE)`
    )
    raw.pragma('user_version = 29')
    const before = raw
      .prepare(
        'SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name'
      )
      .all()
    raw.close()

    expect(requiresWorkerTerminalReleaseReadiness(dbPath)).toBe(false)

    const inspection = new SyncDatabase(dbPath, { readonly: true, fileMustExist: true })
    try {
      expect(inspection.pragma('user_version', { simple: true })).toBe(29)
      expect(
        inspection
          .prepare(
            'SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name'
          )
          .all()
      ).toEqual(before)
    } finally {
      inspection.close()
    }
  })

  it('rechecks the future schema fence after acquiring the repair lock', () => {
    const dbPath = createDatabase()
    const raw = new SyncDatabase(dbPath)
    raw.exec('DROP INDEX idx_dispatch_task')
    raw.exec(
      'CREATE INDEX idx_dispatch_task ON dispatch_contexts(task_id) WHERE assignee_handle IS NOT NULL'
    )
    raw.close()
    const originalExec = SyncDatabase.prototype.exec
    let injectedFutureSchema = false
    const execSpy = vi
      .spyOn(SyncDatabase.prototype, 'exec')
      .mockImplementation(function (this: SyncDatabase, sql) {
        if (sql === 'BEGIN IMMEDIATE' && !injectedFutureSchema) {
          injectedFutureSchema = true
          const future = new SyncDatabase(dbPath)
          future.pragma('user_version = 29')
          future.close()
        }
        return originalExec.call(this, sql)
      })
    const raced = new OrchestrationDb(dbPath)
    raced.close()
    execSpy.mockRestore()

    const inspection = new SyncDatabase(dbPath, { readonly: true, fileMustExist: true })
    try {
      expect(injectedFutureSchema).toBe(true)
      expect(
        inspection
          .prepare('PRAGMA index_list(dispatch_contexts)')
          .all()
          .find((row) => (row as { name?: string }).name === 'idx_dispatch_task')
      ).toMatchObject({ partial: 1 })
      expect(inspection.pragma('user_version', { simple: true })).toBe(29)
    } finally {
      inspection.close()
    }
  })
})
