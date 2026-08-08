import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { afterAll, describe, expect, it } from 'vitest'
import {
  APP_CONSUMER,
  boundary,
  semanticPublication
} from './__tests__/terminal-authority-app-projection-fixture'
import {
  TERMINAL_AUTHORITY_APP_PROJECTION_DATABASE_FILE,
  TerminalAuthorityAppProjectionStore
} from './terminal-authority-app-projection-store'

const ACKNOWLEDGED_HISTORY = 25_000
const PAGE_SIZE = 64
const PROBE_EVENTS = 256
const directories: string[] = []

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true })))
})

describe('TerminalAuthorityAppProjectionStore scale', () => {
  it('keeps event-loop delay, rows touched, and DB/WAL size independent of ACK history', async () => {
    const shallow = await storeAfter(1)
    const deep = await storeAfter(ACKNOWLEDGED_HISTORY)

    expect(deep.store.statistics()).toEqual({
      rows: 1,
      writeTransactions: 1 + Math.ceil(ACKNOWLEDGED_HISTORY / PAGE_SIZE),
      writtenRows: 1 + Math.ceil(ACKNOWLEDGED_HISTORY / PAGE_SIZE)
    })
    expect(deep.wallTimeMs).toBeLessThan(10_000)
    expect(deep.databaseBytes + deep.walBytes).toBeLessThan(2 * 1024 * 1024)
    expect(deep.store.snapshot(APP_CONSUMER.consumerId)).toHaveLength(1)

    const shallowDelay = await eventLoopDelayPercentiles(shallow.store, 2)
    const deepDelay = await eventLoopDelayPercentiles(deep.store, ACKNOWLEDGED_HISTORY + 1)
    const detail = `deep=${JSON.stringify(deepDelay)} shallow=${JSON.stringify(shallowDelay)}`
    expect(deepDelay.p50, detail).toBeLessThan(shallowDelay.p50 * 6 + 25)
    expect(deepDelay.p95, detail).toBeLessThan(shallowDelay.p95 * 6 + 25)
    shallow.store.close()
    deep.store.close()
  }, 30_000)
})

async function storeAfter(count: number): Promise<{
  store: TerminalAuthorityAppProjectionStore
  wallTimeMs: number
  databaseBytes: number
  walBytes: number
}> {
  const directory = await mkdtemp(path.join(tmpdir(), 'orca-app-projection-perf-'))
  directories.push(directory)
  const store = await TerminalAuthorityAppProjectionStore.open({ directory })
  store.beginBoundary(boundary(0))
  const startedAt = performance.now()
  for (let first = 1; first <= count; first += PAGE_SIZE) {
    store.apply(titlePage(first, Math.min(PAGE_SIZE, count - first + 1)))
  }
  const wallTimeMs = performance.now() - startedAt
  const databasePath = path.join(directory, TERMINAL_AUTHORITY_APP_PROJECTION_DATABASE_FILE)
  return {
    store,
    wallTimeMs,
    databaseBytes: await fileSize(databasePath),
    walBytes: await fileSize(`${databasePath}-wal`)
  }
}

async function eventLoopDelayPercentiles(
  store: TerminalAuthorityAppProjectionStore,
  firstSequence: number
): Promise<Readonly<{ p50: number; p95: number }>> {
  const samples: number[] = []
  for (let sample = 0; sample < 7; sample += 1) {
    const startedAt = performance.now()
    const timer = new Promise<number>((resolve) => {
      setTimeout(() => resolve(performance.now() - startedAt), 0)
    })
    for (let offset = 0; offset < PROBE_EVENTS; offset += PAGE_SIZE) {
      const first = firstSequence + sample * PROBE_EVENTS + offset
      store.apply(titlePage(first, PAGE_SIZE))
    }
    samples.push(await timer)
  }
  samples.sort((left, right) => left - right)
  return Object.freeze({
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95)
  })
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!
}

function titlePage(first: number, count: number) {
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
    ...semanticPublication(first),
    previousSequence: first - 1,
    outcome: outcomes[0]!,
    outcomes: Object.freeze(outcomes)
  })
}

async function fileSize(file: string): Promise<number> {
  try {
    return (await stat(file)).size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 0
    }
    throw error
  }
}
