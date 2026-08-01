import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Why this file is separate: the swap in writeAsync is async, so a writer parked on its
// rename has already cleared the generation guard and nothing downstream can veto it.
// flushOrThrow runs synchronously from session checkpoints and renderer shutdown, so a
// stale view landing on top of it is a real loss. Gating rename is the only way to pin it.

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
  return { ...actual, rename }
})

describe('ActiveViewPreference sync flush vs. parked async rename', () => {
  let dir: string
  const viewFile = (): string => join(dir, 'active-view.json')

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-active-view-'))
    gate.blockRename = false
    gate.waiters = []
    gate.renameCalls = 0
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('a write parked on its rename cannot overwrite a later flushOrThrow', async () => {
    const { ActiveViewPreference } = await import('./active-view-preference')
    const pref = new ActiveViewPreference(join(dir, 'orca-data.json'), 'terminal')

    gate.blockRename = true
    pref.set('activity')
    await vi.waitFor(() => expect(gate.renameCalls).toBeGreaterThan(0))
    // Why grab it now: flushOrThrow drops pendingWrite, so waitForPendingWrite would
    // return before the released rename has actually landed.
    const inflight = (pref as unknown as { pendingWrite: Promise<void> | null }).pendingWrite

    // A session checkpoint fires while that write is still parked.
    pref.set('tasks')
    pref.flushOrThrow()
    expect(JSON.parse(readFileSync(viewFile(), 'utf-8')).activeView).toBe('tasks')

    gate.blockRename = false
    gate.waiters.splice(0).forEach((resolve) => resolve())
    await inflight

    expect(JSON.parse(readFileSync(viewFile(), 'utf-8')).activeView).toBe('tasks')
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toHaveLength(0)
  })
})
