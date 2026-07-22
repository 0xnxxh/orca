import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../sqlite/sync-database'
import { OrchestrationDb } from './db'
import { reconcileLifecycleMessage } from './lifecycle-reconciliation'

describe('orchestration lineage survives a restart handle remint', () => {
  let db: OrchestrationDb | undefined
  let tempDir: string | undefined

  afterEach(() => {
    db?.close()
    db = undefined
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  function createDb(): OrchestrationDb {
    db = new OrchestrationDb(':memory:')
    return db
  }

  // Real leaf UUIDs: pane keys are `${tabId}:${leafUuid}`.
  const LEAF_A = '11111111-1111-1111-8111-111111111111'
  const LEAF_B = '22222222-2222-4222-9222-222222222222'

  function createFileDbPath(): string {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-restart-lineage-'))
    return join(tempDir, 'orchestration.sqlite')
  }

  it('reopens persisted creator and active-dispatch pane identities', () => {
    const dbPath = createFileDbPath()
    const beforeRestart = new OrchestrationDb(dbPath)
    const task = beforeRestart.createTask({
      spec: 'work',
      createdByTerminalHandle: 'term_parent_before_restart',
      createdByPaneKey: `tab_parent_before_breakout:${LEAF_A}`
    })
    beforeRestart.createDispatchContext(
      task.id,
      'term_child_before_restart',
      `tab_child_before_breakout:${LEAF_B}`
    )
    beforeRestart.close()

    db = new OrchestrationDb(dbPath)
    expect(db.getTask(task.id)?.created_by_pane_key).toBe(`tab_parent_before_breakout:${LEAF_A}`)
    expect(db.getActiveDispatchForTerminal('term_child_after_restart')).toBeUndefined()
    expect(
      db.getActiveDispatchForTerminal(
        'term_child_after_restart',
        `tab_child_after_breakout:${LEAF_B}`
      )?.task_id
    ).toBe(task.id)
  })

  it('rebinds the dispatch assignee to the resumed worker on the first post-restart heartbeat', () => {
    // Why: the durable self-heal. A heartbeat authorized by dispatchId + pane
    // identity re-anchors the assignee to the reminted handle + current pane
    // key, so exact handle-based resolution recovers with no in-memory state.
    const d = createDb()
    const task = d.createTask({ spec: 'work' })
    const ctx = d.createDispatchContext(task.id, 'term_before_restart', `tab_before:${LEAF_B}`)

    // Pre-heartbeat, only the durable pane identity resolves the dispatch.
    expect(d.getActiveDispatchForTerminal('term_after_restart')).toBeUndefined()

    const heartbeat = d.insertMessage({
      from: 'term_after_restart',
      to: 'coordinator',
      subject: 'hb',
      type: 'heartbeat',
      payload: JSON.stringify({ dispatchId: ctx.id }),
      senderPaneKey: `tab_after:${LEAF_B}`
    })
    expect(reconcileLifecycleMessage(d, heartbeat).action).toBe('heartbeat_recorded')

    const rebound = d.getActiveDispatchForTerminal('term_after_restart')
    expect(rebound?.id).toBe(ctx.id)
    expect(rebound?.assignee_pane_key).toBe(`tab_after:${LEAF_B}`)
    // The stale pre-restart handle no longer owns it.
    expect(d.getActiveDispatchForTerminal('term_before_restart')).toBeUndefined()
  })

  it('does not rebind a closed dispatch from a late heartbeat', () => {
    // Why: rebind is scoped to live dispatches — a straggler heartbeat after
    // completion must not resurrect assignee identity on a done row.
    const d = createDb()
    const task = d.createTask({ spec: 'work' })
    const ctx = d.createDispatchContext(task.id, 'term_old', `tab_before:${LEAF_A}`)
    d.completeDispatch(ctx.id)

    d.rebindDispatchAssignee(ctx.id, 'term_new', `tab_after:${LEAF_A}`)
    expect(d.getDispatchContextById(ctx.id)?.assignee_handle).toBe('term_old')
  })

  it('finds a completed dispatch by its current pane key after a remint and breakout', () => {
    const d = createDb()
    const task = d.createTask({ spec: 'work' })
    const ctx = d.createDispatchContext(task.id, 'term_old', `tab_before:${LEAF_B}`)
    d.completeDispatch(ctx.id)

    expect(d.getLatestDispatchForTerminal('term_new')).toBeUndefined()
    const remint = d.getLatestDispatchForTerminal('term_new', `tab_after:${LEAF_B}`)
    expect(remint?.id).toBe(ctx.id)
    expect(remint?.status).toBe('completed')
  })

  it('migrates a v6 task table before persisting creator pane identity', () => {
    const dbPath = createFileDbPath()
    const raw = new Database(dbPath)
    raw.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        created_by_terminal_handle TEXT,
        task_title TEXT,
        display_name TEXT,
        spec TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        deps TEXT NOT NULL DEFAULT '[]',
        result TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );
      INSERT INTO tasks (id, created_by_terminal_handle, spec, status)
        VALUES ('task_v6', 'term_legacy', 'legacy work', 'ready');
    `)
    raw.pragma('user_version = 6')
    raw.close()

    db = new OrchestrationDb(dbPath)
    expect(db.getTask('task_v6')?.created_by_pane_key).toBeNull()
    const created = db.createTask({
      spec: 'new work',
      createdByPaneKey: `tab_parent:${LEAF_A}`
    })
    expect(created.created_by_pane_key).toBe(`tab_parent:${LEAF_A}`)
    expect(readUserVersion(dbPath)).toBe(8)
  })

  // Why: real orca-dev DBs stamped user_version=7 before created_by_pane_key
  // shipped; short-circuit alone left task-create INSERT failing forever.
  it('repairs a v7-stamped task table missing created_by_pane_key', () => {
    const dbPath = createFileDbPath()
    const raw = new Database(dbPath)
    raw.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        created_by_terminal_handle TEXT,
        task_title TEXT,
        display_name TEXT,
        spec TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        deps TEXT NOT NULL DEFAULT '[]',
        result TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );
      INSERT INTO tasks (id, created_by_terminal_handle, spec, status)
        VALUES ('task_stuck_v7', 'term_legacy', 'legacy work', 'ready');
    `)
    raw.pragma('user_version = 7')
    raw.close()

    db = new OrchestrationDb(dbPath)
    expect(db.getTask('task_stuck_v7')?.created_by_pane_key).toBeNull()
    const created = db.createTask({
      spec: 'repaired work',
      createdByPaneKey: `tab_parent:${LEAF_A}`
    })
    expect(created.created_by_pane_key).toBe(`tab_parent:${LEAF_A}`)
    expect(readUserVersion(dbPath)).toBe(8)
  })

  // Why: even a current stamp can lie; ensureColumn must still heal.
  it('repairs a v8-stamped task table missing created_by_pane_key', () => {
    const dbPath = createFileDbPath()
    const raw = new Database(dbPath)
    raw.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        created_by_terminal_handle TEXT,
        task_title TEXT,
        display_name TEXT,
        spec TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        deps TEXT NOT NULL DEFAULT '[]',
        result TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );
    `)
    raw.pragma('user_version = 8')
    raw.close()

    db = new OrchestrationDb(dbPath)
    const created = db.createTask({
      spec: 'healed work',
      createdByPaneKey: `tab_parent:${LEAF_A}`
    })
    expect(created.created_by_pane_key).toBe(`tab_parent:${LEAF_A}`)
  })
})

function readUserVersion(dbPath: string): number {
  const raw = new Database(dbPath)
  try {
    return raw.pragma('user_version', { simple: true }) as number
  } finally {
    raw.close()
  }
}
