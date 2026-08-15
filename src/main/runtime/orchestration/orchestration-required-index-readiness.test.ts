import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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
      expect(
        db
          .prepare(`PRAGMA index_info(${indexName})`)
          .all()
          .find((row) => (row as { seqno?: number }).seqno === 0)
      ).toMatchObject({ name: leadingColumn })
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
    ['unique', 'CREATE UNIQUE INDEX idx_dispatch_task ON dispatch_contexts(task_id)']
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

  it('preserves a future schema index definition during downgrade', () => {
    const dbPath = createDatabase()
    const raw = new SyncDatabase(dbPath)
    raw.exec('DROP INDEX idx_dispatch_task')
    raw.exec(
      'CREATE INDEX idx_dispatch_task ON dispatch_contexts(task_id) WHERE assignee_handle IS NOT NULL'
    )
    raw.pragma('user_version = 29')
    raw.close()

    const downgraded = new OrchestrationDb(dbPath)
    downgraded.close()
    const inspection = new SyncDatabase(dbPath, { readonly: true, fileMustExist: true })
    try {
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
