import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The veto makes a sync write win over an async write parked on `rename`, and the
// async side then retries. That retry re-runs the caller's mutation against a
// re-read index, so it is only safe if the vetoed attempt left nothing of its own
// on disk — otherwise an append would be applied twice.

const gate = vi.hoisted(() => ({
  blockRename: false,
  waiters: [] as (() => void)[],
  renameCalls: 0
}))

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof FsPromises>('node:fs/promises')
  const rename = (async (...args: Parameters<typeof actual.rename>) => {
    gate.renameCalls += 1
    if (gate.blockRename) {
      await new Promise<void>((resolve) => gate.waiters.push(resolve))
    }
    return actual.rename(...args)
  }) as typeof actual.rename
  return { ...actual, default: { ...actual, rename }, rename }
})

describe('profile index veto retry integrity', () => {
  let userDataPath: string
  const indexPath = (): string => join(userDataPath, 'orca-profile-index.json')
  const readIndex = (): { profiles: { id: string }[] } =>
    JSON.parse(readFileSync(indexPath(), 'utf-8'))

  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'orca-profile-veto-'))
    gate.blockRename = false
    gate.waiters = []
    gate.renameCalls = 0
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
  })

  it('a sync write that vetoes a parked async append does not duplicate the retried profile', async () => {
    const { createLocalOrcaProfileAsync } = await import('./profile-index-async-store')
    const { createLocalOrcaProfile, getOrcaProfileListState } =
      await import('./profile-index-store')

    // Seed the index so the async attempt below is a real append, not a first create.
    createLocalOrcaProfile({ name: 'seed' }, userDataPath)
    const seedCount = getOrcaProfileListState(userDataPath).profiles.length

    gate.blockRename = true
    const pending = createLocalOrcaProfileAsync({ name: 'async-profile' }, userDataPath)
    await vi.waitFor(() => expect(gate.renameCalls).toBeGreaterThan(0))

    // The sync writer lands while the async writer is parked on its rename.
    createLocalOrcaProfile({ name: 'sync-profile' }, userDataPath)

    gate.blockRename = false
    gate.waiters.splice(0).forEach((resolve) => resolve())
    await pending

    // Guards the test itself: without a second rename the veto never fired and the
    // assertions below would pass without exercising the retry at all.
    expect(gate.renameCalls).toBeGreaterThan(1)

    const names = readIndex().profiles.map((p) => (p as { name?: string }).name)
    const asyncOccurrences = names.filter((n) => n === 'async-profile').length
    const syncOccurrences = names.filter((n) => n === 'sync-profile').length

    // Neither writer may be lost, and the retried one may not be applied twice.
    expect(asyncOccurrences).toBe(1)
    expect(syncOccurrences).toBe(1)
    expect(readIndex().profiles).toHaveLength(seedCount + 2)
    expect(new Set(readIndex().profiles.map((p) => p.id)).size).toBe(seedCount + 2)
    expect(readdirSync(userDataPath).filter((f) => f.includes('.tmp'))).toEqual([])
  })
})
