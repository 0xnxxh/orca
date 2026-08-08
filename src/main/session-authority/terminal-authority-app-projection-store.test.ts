import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
  type TerminalAuthorityAppBellClearRequest
} from '../../shared/terminal-authority-app-projection'
import type { TerminalSessionAuthoritySemanticFact } from '../../shared/terminal-session-authority-mutation'
import {
  APP_CONSUMER,
  authorityProjection,
  boundary,
  exitPublication,
  semanticPublication
} from './__tests__/terminal-authority-app-projection-fixture'
import {
  TERMINAL_AUTHORITY_COMMAND_CODE_SETTLE_MS,
  TERMINAL_AUTHORITY_PR_VERIFY_DELAY_MS
} from './terminal-authority-app-projection-reducer'
import {
  TERMINAL_AUTHORITY_APP_PROJECTION_DATABASE_FILE,
  TerminalAuthorityAppProjectionStore
} from './terminal-authority-app-projection-store'
import SyncDatabase from '../sqlite/sync-database'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('TerminalAuthorityAppProjectionStore', () => {
  it('materializes all twelve fact domains with event keys and restartable state', async () => {
    let now = 1_000
    const store = await memoryStore(undefined, () => now)
    initialize(store)
    const facts: readonly TerminalSessionAuthoritySemanticFact[] = [
      { kind: 'agent-status', payload: { state: 'working', prompt: 'ship it' } },
      { kind: 'title', normalizedTitle: 'Build', rawTitle: 'Build' },
      { kind: 'bell' },
      { kind: 'agent-working' },
      { kind: 'agent-idle', title: 'Done' },
      { kind: 'agent-exited' },
      { kind: 'command-finished', exitCode: 0 },
      {
        kind: 'pr-link',
        link: {
          url: 'https://github.com/orca/test/pull/1',
          slug: { owner: 'orca', repo: 'test', host: 'github.com' },
          number: 1
        }
      },
      { kind: 'command-code-working', prompt: 'work' },
      { kind: 'command-code-done', prompt: 'done' },
      { kind: '2031-subscribe' },
      { kind: '2031-unsubscribe' }
    ]

    facts.forEach((fact, index) => {
      now += 1
      store.apply(semanticPublication(index + 1, fact))
    })

    const row = store.snapshot(APP_CONSUMER.consumerId)[0]!
    expect(Object.keys(row.facts).sort()).toEqual(facts.map((fact) => fact.kind).sort())
    for (const [index, fact] of facts.entries()) {
      expect(row.facts[fact.kind]).toMatchObject({
        event: { sequence: index + 1, outcomeId: `semantic-namespace-1-${index + 1}` },
        fact
      })
    }
    expect(row).toMatchObject({
      layout: { tabId: 'tab-1', leafId: '11111111-1111-4111-8111-111111111111' },
      attention: { pendingBellCount: 1 },
      commandCode: {
        state: 'settling',
        settleAt: 1_000 + 10 + TERMINAL_AUTHORITY_COMMAND_CODE_SETTLE_MS
      }
    })
    expect(store.statistics()).toEqual({ rows: 1, writeTransactions: 13, writtenRows: 13 })
    store.close()
  })

  it('replays commit-before-host-ACK pages as a durable no-op after process restart', async () => {
    const directory = await tempDirectory()
    const first = await TerminalAuthorityAppProjectionStore.open({ directory })
    initialize(first)
    const page = publicationPage(1, 64)
    expect(first.apply(page).rows).toHaveLength(1)
    expect(first.statistics()).toMatchObject({ writeTransactions: 2, writtenRows: 2 })
    first.close()

    const restarted = await TerminalAuthorityAppProjectionStore.open({ directory })
    expect(restarted.apply(structuredClone(page))).toEqual({ rows: [], deleted: [] })
    expect(restarted.statistics()).toEqual({ rows: 1, writeTransactions: 0, writtenRows: 0 })
    expect(restarted.snapshot(APP_CONSUMER.consumerId)[0]?.facts.title?.event.sequence).toBe(64)
    restarted.close()
  })

  it('rejects a conflicting outcome at an already projected namespace sequence', async () => {
    const store = await memoryStore()
    initialize(store)
    store.apply(semanticPublication(1))

    expect(() =>
      store.apply(semanticPublication(1, { kind: 'bell' }, { outcomeId: 'conflicting-outcome' }))
    ).toThrow('event conflicts')
    expect(store.snapshot(APP_CONSUMER.consumerId)[0]?.latestEvent?.outcomeId).toBe(
      'semantic-namespace-1-1'
    )
    store.close()
  })

  it('rolls back a crash before commit and applies the event on reopen', async () => {
    const directory = await tempDirectory()
    const initialized = await TerminalAuthorityAppProjectionStore.open({ directory })
    initialize(initialized)
    initialized.close()
    const crashing = await TerminalAuthorityAppProjectionStore.open({
      directory,
      beforeCommit: () => {
        throw new Error('simulated process loss')
      }
    })

    expect(() => crashing.apply(semanticPublication(1))).toThrow('simulated process loss')
    expect(crashing.statistics()).toEqual({ rows: 1, writeTransactions: 0, writtenRows: 0 })
    crashing.close()

    const restarted = await TerminalAuthorityAppProjectionStore.open({ directory })
    expect(restarted.apply(semanticPublication(1)).rows).toHaveLength(1)
    expect(restarted.snapshot(APP_CONSUMER.consumerId)[0]?.facts.bell).toBeDefined()
    restarted.close()
  })

  it('fails closed when a nested durable row is corrupt after reopen', async () => {
    const directory = await tempDirectory()
    const first = await TerminalAuthorityAppProjectionStore.open({ directory })
    initialize(first)
    const row = first.snapshot(APP_CONSUMER.consumerId)[0]!
    first.close()

    const database = new SyncDatabase(
      path.join(directory, TERMINAL_AUTHORITY_APP_PROJECTION_DATABASE_FILE)
    )
    database.prepare('UPDATE terminal_authority_app_projection SET projection_json = ?').run(
      JSON.stringify({
        ...row,
        attention: { ...row.attention, pendingBellCount: -1 }
      })
    )
    database.close()

    const reopened = await TerminalAuthorityAppProjectionStore.open({ directory })
    expect(() => reopened.snapshot(APP_CONSUMER.consumerId)).toThrow(
      'terminal authority app projection row identity changed'
    )
    reopened.close()
  })

  it('persists an event-fenced bell clear across restart and duplicate replay', async () => {
    const directory = await tempDirectory()
    const publication = semanticPublication(1)
    const first = await TerminalAuthorityAppProjectionStore.open({ directory })
    initialize(first)
    first.apply(publication)
    const row = first.snapshot(APP_CONSUMER.consumerId)[0]!
    const request: TerminalAuthorityAppBellClearRequest = {
      version: TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
      consumerId: APP_CONSUMER.consumerId,
      namespace: row.namespace,
      pane: row.pane,
      expectedEvent: row.facts.bell!.event
    }
    expect(first.clearBell(request)?.attention.pendingBellCount).toBe(0)
    first.close()

    const restarted = await TerminalAuthorityAppProjectionStore.open({ directory })
    expect(restarted.apply(publication).rows).toEqual([])
    expect(restarted.snapshot(APP_CONSUMER.consumerId)[0]?.attention.pendingBellCount).toBe(0)
    expect(
      restarted.clearBell({
        ...request,
        expectedEvent: { ...request.expectedEvent, outcomeId: 'wrong-outcome' }
      })
    ).toBeNull()
    restarted.close()
  })

  it('retains PR and Command Code deadlines across restart', async () => {
    const directory = await tempDirectory()
    let now = 1_000
    const first = await TerminalAuthorityAppProjectionStore.open({ directory, now: () => now })
    initialize(first)
    first.apply(
      semanticPublication(1, {
        kind: 'pr-link',
        link: {
          url: 'https://github.com/orca/test/pull/2',
          slug: { owner: 'orca', repo: 'test', host: 'github.com' },
          number: 2
        }
      })
    )
    first.apply(semanticPublication(2, { kind: 'command-code-done', prompt: 'done' }))
    first.close()

    now += TERMINAL_AUTHORITY_COMMAND_CODE_SETTLE_MS
    const restarted = await TerminalAuthorityAppProjectionStore.open({ directory, now: () => now })
    expect(restarted.settleDueCommandCode()).toHaveLength(1)
    expect(restarted.snapshot(APP_CONSUMER.consumerId)[0]?.commandCode?.state).toBe('done')
    now = 1_000 + TERMINAL_AUTHORITY_PR_VERIFY_DELAY_MS
    expect(restarted.duePrVerifications()).toHaveLength(1)
    restarted.close()
  })

  it('atomically installs complete host semantics and preserves an event-fenced bell clear', async () => {
    const directory = await tempDirectory()
    const ptyIncarnationId = 'pty-incarnation-pane-generation-1'
    const title = semanticPublication(
      1,
      { kind: 'title', normalizedTitle: 'Recovered', rawTitle: 'Recovered' },
      { ptyIncarnationId }
    ).outcome
    const bell = semanticPublication(2, { kind: 'bell' }, { ptyIncarnationId }).outcome
    const agent = semanticPublication(3, { kind: 'agent-working' }, { ptyIncarnationId }).outcome
    const exit = exitPublication(4).outcome
    if (exit.kind === 'semantic') {
      throw new Error('exit fixture returned a semantic outcome')
    }
    const projection = authorityProjection({
      revision: 5,
      panes: [{ ...exit.result.pane, ownerStatus: null }],
      materializedOutcomes: [title, bell, agent, exit]
    })
    const complete = boundary(4, { projection, consumerStart: 'new-at-tail' })
    const store = await TerminalAuthorityAppProjectionStore.open({ directory })

    const installed = store.beginBoundary(complete).rows[0]!

    expect(installed).toMatchObject({
      facts: {
        title: { event: { sequence: 1 } },
        bell: { event: { sequence: 2 } },
        'agent-working': { event: { sequence: 3 } }
      },
      agent: { event: { sequence: 4 }, state: 'exited' },
      exit: { event: { sequence: 4 }, code: 17 },
      attention: { pendingBellCount: 1 }
    })
    const cleared = store.clearBell({
      version: TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
      consumerId: installed.consumerId,
      namespace: installed.namespace,
      pane: installed.pane,
      expectedEvent: installed.facts.bell!.event
    })
    expect(cleared?.attention.pendingBellCount).toBe(0)
    expect(store.beginBoundary({ ...complete, consumerStart: 'resume' }).rows).toEqual([])
    expect(store.snapshot(APP_CONSUMER.consumerId)[0]?.attention.pendingBellCount).toBe(0)
    store.close()
  })

  it('preserves a later replayed event when the boundary materializes only older facts', async () => {
    const store = await memoryStore()
    const exited = exitPublication(2)
    if (exited.outcome.kind === 'semantic') {
      throw new Error('exit fixture returned a semantic outcome')
    }
    const change = exited.outcome.request.change
    if (change.kind !== 'exit') {
      throw new Error('exit fixture returned a non-exit mutation')
    }
    const binding = change.expected.binding
    if (!binding) {
      throw new Error('exit fixture returned no expected binding')
    }
    const pane = authorityProjection().panes[0]!
    store.beginBoundary(
      boundary(0, {
        projection: authorityProjection({
          panes: [{ ...pane, binding, lastBinding: binding }]
        })
      })
    )
    const bell = semanticPublication(
      1,
      { kind: 'bell' },
      {
        ptyIncarnationId: binding.ptyIncarnationId
      }
    )
    store.apply({ ...bell, outcomes: [bell.outcome, exited.outcome] })
    const resumed = boundary(0, {
      outcomeHighWatermark: 2,
      consumerStart: 'resume',
      projection: authorityProjection({
        revision: 3,
        panes: [{ ...exited.outcome.result.pane, ownerStatus: 'reachable' }],
        materializedOutcomes: [bell.outcome]
      })
    })

    store.beginBoundary(resumed)
    store.completeBoundary(resumed)
    const beforeReplay = store.statistics()

    expect(store.snapshot(APP_CONSUMER.consumerId)[0]?.latestEvent).toMatchObject({
      sequence: 2,
      outcomeId: exited.outcome.outcomeId
    })
    expect(store.apply(exited)).toEqual({ rows: [], deleted: [] })
    expect(store.statistics()).toEqual(beforeReplay)
    store.close()
  })

  it('rejects an equal-sequence boundary event with a different outcome identity', async () => {
    const store = await memoryStore()
    initialize(store)
    store.apply(semanticPublication(1))
    const conflict = semanticPublication(1, { kind: 'bell' }, { outcomeId: 'conflicting-id' })

    expect(() =>
      store.beginBoundary(
        boundary(1, {
          consumerStart: 'resume',
          projection: authorityProjection({
            revision: 2,
            materializedOutcomes: [conflict.outcome]
          })
        })
      )
    ).toThrow('event conflicts')

    expect(store.snapshot(APP_CONSUMER.consumerId)[0]?.latestEvent?.outcomeId).toBe(
      'semantic-namespace-1-1'
    )
    store.close()
  })

  it('rolls back the complete semantic boundary when its durable commit crashes', async () => {
    const directory = await tempDirectory()
    const store = await TerminalAuthorityAppProjectionStore.open({
      directory,
      beforeCommit: () => {
        throw new Error('crash before boundary commit')
      }
    })
    const outcome = semanticPublication(1).outcome
    const complete = boundary(1, {
      projection: authorityProjection({ revision: 2, materializedOutcomes: [outcome] })
    })

    expect(() => store.beginBoundary(complete)).toThrow('crash before boundary commit')

    expect(store.snapshot(APP_CONSUMER.consumerId)).toEqual([])
    expect(store.statistics()).toEqual({ rows: 0, writeTransactions: 0, writtenRows: 0 })
    store.close()
    const reopened = await TerminalAuthorityAppProjectionStore.open({ directory })
    expect(reopened.snapshot(APP_CONSUMER.consumerId)).toEqual([])
    expect(reopened.beginBoundary(complete).rows).toHaveLength(1)
    reopened.close()
  })

  it('reconciles unbound panes and deletes rows absent from the next authority snapshot', async () => {
    const store = await memoryStore()
    const initial = boundary(0, {
      projection: authorityProjection({ bound: false, paneGenerationId: 'unbound' })
    })
    expect(store.beginBoundary(initial).rows[0]).toMatchObject({
      pane: { paneGenerationId: 'unbound' },
      binding: null,
      topology: { binding: null, lastBinding: null }
    })

    const empty = boundary(0, { projection: authorityProjection({ revision: 2, panes: [] }) })
    const change = store.beginBoundary(empty)
    expect(change.deleted).toHaveLength(1)
    expect(store.snapshot(APP_CONSUMER.consumerId)).toEqual([])
    store.close()
  })

  it('refreshes transient owner reachability at an unchanged authority revision', async () => {
    const store = await memoryStore()
    initialize(store)
    const pane = authorityProjection().panes[0]!

    const change = store.beginBoundary(
      boundary(0, {
        projection: authorityProjection({
          panes: [{ ...pane, ownerStatus: 'owner-unreachable' }]
        })
      })
    )

    expect(change.rows[0]?.topology).toMatchObject({
      authorityRevision: pane.revision,
      ownerStatus: 'owner-unreachable'
    })
    expect(store.snapshot(APP_CONSUMER.consumerId)[0]?.topology.ownerStatus).toBe(
      'owner-unreachable'
    )
    store.close()
  })

  it('fails closed when returning identity lost initialized projection history', async () => {
    const store = await memoryStore()
    expect(() => store.beginBoundary(boundary(25, { consumerStart: 'resume' }))).toThrow(
      'history is unavailable'
    )
    expect(store.statistics()).toEqual({ rows: 0, writeTransactions: 0, writtenRows: 0 })
    expect(store.beginBoundary(boundary(25, { consumerStart: 'new-at-tail' })).rows).toHaveLength(1)
    store.close()
  })

  it('isolates consumers and uses O(1) row capacity accounting', async () => {
    const store = await memoryStore(2)
    const other = { consumerId: 'app-profile:other', consumerIncarnationId: 'app-process:other' }
    initialize(store)
    store.beginBoundary({ ...boundary(0), consumer: other })
    expect(store.snapshot(APP_CONSUMER.consumerId)).toHaveLength(1)
    expect(store.snapshot(other.consumerId)).toHaveLength(1)

    const originalPane = authorityProjection().panes[0]!
    const thirdPane = Object.freeze({
      ...originalPane,
      paneGenerationId: 'third-generation',
      revision: 2
    })

    expect(() =>
      store.beginBoundary(
        boundary(0, {
          projection: authorityProjection({ revision: 2, panes: [originalPane, thirdPane] })
        })
      )
    ).toThrow('capacity exceeded')
    expect(store.statistics().rows).toBe(2)
    store.close()
  })
})

function initialize(store: TerminalAuthorityAppProjectionStore): void {
  store.beginBoundary(boundary(0))
}

function publicationPage(first: number, count: number) {
  const outcomes = Array.from(
    { length: count },
    (_, offset) =>
      semanticPublication(first + offset, {
        kind: 'title',
        normalizedTitle: `title-${first + offset}`,
        rawTitle: `title-${first + offset}`
      }).outcome
  )
  return Object.freeze({
    ...semanticPublication(
      first,
      outcomes[0]!.kind === 'semantic' ? outcomes[0].fact : { kind: 'bell' }
    ),
    previousSequence: first - 1,
    outcome: outcomes[0]!,
    outcomes: Object.freeze(outcomes)
  })
}

async function memoryStore(
  maxRows?: number,
  now?: () => number
): Promise<TerminalAuthorityAppProjectionStore> {
  return TerminalAuthorityAppProjectionStore.open({
    directory: await tempDirectory(),
    databasePath: ':memory:',
    ...(maxRows ? { maxRows } : {}),
    ...(now ? { now } : {})
  })
}

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'orca-app-projection-'))
  directories.push(directory)
  return directory
}
