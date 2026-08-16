import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type Database from '../../sqlite/sync-database'
import { OrchestrationDb } from './db'

type DatabaseHarness = {
  db: OrchestrationDb
  dir: string
  path: string
}

const harnesses: DatabaseHarness[] = []

afterEach(() => {
  vi.restoreAllMocks()
  const closed = harnesses.splice(0)
  for (const harness of closed) {
    harness.db.close()
  }
  for (const dir of new Set(closed.map((harness) => harness.dir))) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Task/Dispatch invariant transactions', () => {
  it.each(['completed', 'failed'] as const)(
    'rolls back a %s Task when Dispatch settlement fails',
    (status) => {
      const { db } = createDatabase()
      const task = db.createTask({ spec: 'atomic work' })
      const dependent = db.createTask({ spec: 'dependent work', deps: [task.id] })
      const dispatch = db.createDispatchContext(task.id, 'term_worker')
      const capability = db.mintDispatchCapability({
        dispatchId: dispatch.id,
        paneKey: 'tab_worker:leaf_worker',
        processIncarnation: 'worker:1'
      })
      sqliteFor(db).exec(`
        CREATE TRIGGER reject_dispatch_settlement
        BEFORE UPDATE OF status ON dispatch_contexts
        WHEN OLD.id = '${dispatch.id}'
        BEGIN
          SELECT RAISE(ABORT, 'forced dispatch settlement failure');
        END;
      `)

      expect(() => db.updateTaskStatus(task.id, status, 'must roll back')).toThrow(
        'forced dispatch settlement failure'
      )
      expect(db.getTask(task.id)).toMatchObject({
        status: 'dispatched',
        result: null,
        completed_at: null
      })
      expect(db.getDispatchContextById(dispatch.id)).toMatchObject({
        status: 'dispatched',
        completed_at: null,
        capability_revoked_at: null
      })
      expect(
        db.verifyDispatchCapability({
          dispatchId: dispatch.id,
          capability,
          paneKey: 'tab_worker:leaf_worker',
          processIncarnation: 'worker:1'
        })
      ).toEqual({ valid: true })
      expect(db.getTask(dependent.id)?.status).toBe('pending')
    }
  )

  it('does not commit a caller-owned transaction', () => {
    const { db } = createDatabase()
    const task = db.createTask({ spec: 'outer transaction work' })
    const dispatch = db.createDispatchContext(task.id, 'term_worker')
    const sqlite = sqliteFor(db)

    sqlite.exec('BEGIN IMMEDIATE')
    db.updateTaskStatus(task.id, 'failed', 'inside outer transaction')
    expect(db.getTask(task.id)?.status).toBe('failed')
    expect(db.getDispatchContextById(dispatch.id)?.status).toBe('failed')
    sqlite.exec('ROLLBACK')

    expect(db.getTask(task.id)).toMatchObject({
      status: 'dispatched',
      result: null,
      completed_at: null
    })
    expect(db.getDispatchContextById(dispatch.id)).toMatchObject({
      status: 'dispatched',
      completed_at: null,
      capability_revoked_at: null
    })
  })

  it('keeps Dispatch creation inside a caller-owned transaction', () => {
    const { db } = createDatabase()
    const task = db.createTask({ spec: 'outer transaction dispatch' })
    const sqlite = sqliteFor(db)

    sqlite.exec('BEGIN IMMEDIATE')
    const dispatch = db.createDispatchContext(task.id, 'term_worker')
    expect(db.getTask(task.id)?.status).toBe('dispatched')
    expect(db.getDispatchContextById(dispatch.id)?.status).toBe('dispatched')
    sqlite.exec('ROLLBACK')

    expect(db.getTask(task.id)?.status).toBe('ready')
    expect(db.getDispatchContextById(dispatch.id)).toBeUndefined()
  })

  it.each(['completed', 'failed'] as const)(
    'settles every active Dispatch left by a pre-fix split when the Task becomes %s',
    (status) => {
      const { db } = createDatabase()
      const task = db.createTask({ spec: 'legacy split work' })
      const first = db.createDispatchContext(task.id, 'term_first')
      sqliteFor(db).prepare("UPDATE tasks SET status = 'ready' WHERE id = ?").run(task.id)
      const second = db.createDispatchContext(task.id, 'term_second')

      db.updateTaskStatus(task.id, status, 'terminal result')

      for (const dispatch of [first, second]) {
        expect(db.getDispatchContextById(dispatch.id)).toMatchObject({
          status,
          completed_at: expect.any(String),
          capability_revoked_at: expect.any(String)
        })
      }
      expect(db.getActiveDispatchForTerminal('term_first')).toBeUndefined()
      expect(db.getActiveDispatchForTerminal('term_second')).toBeUndefined()
      expect(() =>
        db.createDispatchContext(db.createTask({ spec: 'first later work' }).id, 'term_first')
      ).not.toThrow()
      expect(() =>
        db.createDispatchContext(db.createTask({ spec: 'second later work' }).id, 'term_second')
      ).not.toThrow()
    }
  )

  it.each(['pending', 'ready', 'blocked'] as const)(
    'rejects moving a Task to %s while a Dispatch remains active',
    (status) => {
      const { db } = createDatabase()
      const task = db.createTask({ spec: 'guarded work' })
      const dispatch = db.createDispatchContext(task.id, 'term_worker')

      expect(() => db.updateTaskStatus(task.id, status, 'must not persist')).toThrowError(
        expect.objectContaining({
          code: 'task_not_startable',
          data: { taskId: task.id, dispatchId: dispatch.id }
        })
      )
      expect(db.getTask(task.id)).toMatchObject({ status: 'dispatched', result: null })
      expect(db.getDispatchContextById(dispatch.id)?.status).toBe('dispatched')
    }
  )

  it('rejects moving a Task to dispatched without an active Dispatch', () => {
    const { db } = createDatabase()
    const task = db.createTask({ spec: 'unassigned work' })

    expect(() => db.updateTaskStatus(task.id, 'dispatched')).toThrowError(
      expect.objectContaining({
        code: 'task_not_startable',
        data: { taskId: task.id }
      })
    )
    expect(db.getTask(task.id)?.status).toBe('ready')
  })

  it('rejects a Dispatch when failure wins after readiness was observed', () => {
    const first = createDatabase()
    const concurrent = createDatabase(first.path)
    const task = first.db.createTask({ spec: 'interleaved work' })
    const sqlite = sqliteFor(first.db)
    const prepare = sqlite.prepare.bind(sqlite)
    let injected = false
    vi.spyOn(sqlite, 'prepare').mockImplementation((sql) => {
      if (!injected && sql.includes('INSERT INTO dispatch_contexts')) {
        injected = true
        concurrent.db.updateTaskStatus(task.id, 'failed', 'failure won')
      }
      return prepare(sql)
    })

    expect(() => first.db.createDispatchContext(task.id, 'term_worker')).toThrow(
      `Task ${task.id} is failed; only ready tasks can be dispatched`
    )
    expect(injected).toBe(true)
    expect(first.db.getTask(task.id)).toMatchObject({ status: 'failed', result: 'failure won' })
    expect(first.db.getDispatchContext(task.id)).toBeUndefined()
  })
})

function createDatabase(path?: string): DatabaseHarness {
  const dir = path ? harnesses.find((harness) => harness.path === path)?.dir : undefined
  const ownedDir = dir ?? mkdtempSync(join(tmpdir(), 'orca-task-dispatch-db-'))
  const dbPath = path ?? join(ownedDir, 'orchestration.db')
  const harness = { db: new OrchestrationDb(dbPath), dir: ownedDir, path: dbPath }
  harnesses.push(harness)
  return harness
}

function sqliteFor(db: OrchestrationDb): Database.Database {
  return (db as unknown as { db: Database.Database }).db
}
