import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Why: freeze #30. Hermes ran up to five sync fs probes per status call against
// ~/.hermes. On a stalled SMB/NFS mount those block the Electron main thread for
// tens of seconds: no repaint, no menus, no Force Quit.
const { syncFsCalls, hangReads, stalledRoot, STALLED_MOUNT_BLOCK_MS, TIMER_BUDGET_MS } = vi.hoisted(
  () => ({
    syncFsCalls: [] as string[],
    hangReads: { value: false },
    stalledRoot: { value: '' },
    STALLED_MOUNT_BLOCK_MS: 1_000,
    TIMER_BUDGET_MS: 500
  })
)

vi.mock('node:fs', async () => {
  const actual = (await vi.importActual('node:fs')) as Record<string, unknown>
  const wrapped: Record<string, unknown> = { ...actual }
  for (const [name, value] of Object.entries(actual)) {
    if (name.endsWith('Sync') && typeof value === 'function') {
      wrapped[name] = (...args: unknown[]) => {
        const target = String(args[0])
        syncFsCalls.push(`${name}:${target}`)
        if (hangReads.value && stalledRoot.value && target.startsWith(stalledRoot.value)) {
          // Why: a stalled SMB/NFS mount parks a *Sync call in the kernel with
          // the event loop still on the stack; Atomics.wait is the only faithful
          // way to reproduce that from JS.
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, STALLED_MOUNT_BLOCK_MS)
        }
        return (value as (...a: unknown[]) => unknown)(...args)
      }
    }
  }
  return { ...wrapped, default: wrapped }
})

vi.mock('node:fs/promises', async () => {
  const actual = (await vi.importActual('node:fs/promises')) as typeof FsPromises
  const readFile = (...args: Parameters<typeof actual.readFile>): Promise<unknown> =>
    hangReads.value ? new Promise<never>(() => {}) : actual.readFile(...args)
  return { ...actual, default: { ...actual, readFile }, readFile }
})

import { HermesHookService } from './hook-service'

describe('HermesHookService main-thread fs', () => {
  let homeDir: string
  let previousHermesHome: string | undefined

  beforeEach(() => {
    previousHermesHome = process.env.HERMES_HOME
    homeDir = mkdtempSync(join(tmpdir(), 'orca-hermes-sync-fs-'))
    process.env.HERMES_HOME = homeDir
    hangReads.value = false
    stalledRoot.value = homeDir
  })

  afterEach(() => {
    hangReads.value = false
    stalledRoot.value = ''
    if (previousHermesHome === undefined) {
      delete process.env.HERMES_HOME
    } else {
      process.env.HERMES_HOME = previousHermesHome
    }
    rmSync(homeDir, { recursive: true, force: true })
  })

  it('reads status without a single synchronous fs syscall', async () => {
    writeFileSync(join(homeDir, 'config.yaml'), 'plugins:\n  enabled: []\n', 'utf-8')

    syncFsCalls.length = 0
    await new HermesHookService().getStatus()

    expect(syncFsCalls).toEqual([])
  })

  it('installs and removes without a single synchronous fs syscall', async () => {
    const service = new HermesHookService()

    syncFsCalls.length = 0
    const installed = await service.install()
    expect(installed.state).toBe('installed')
    expect(syncFsCalls).toEqual([])

    syncFsCalls.length = 0
    const removed = await service.remove()
    expect(removed.state).toBe('not_installed')
    expect(syncFsCalls).toEqual([])
  })

  // Why: the point of the async conversion is that a stalled ~/.hermes still
  // lets timers/repaints/menus run. Arm the timer *before* the call — a sync
  // reader blocks inside getStatus(), so lateness measured afterwards misses it.
  it('keeps the event loop alive while ~/.hermes reads hang', async () => {
    hangReads.value = true
    syncFsCalls.length = 0

    const armedAt = Date.now()
    let observedDelayMs = -1
    const timer = new Promise<void>((resolve) => {
      setTimeout(() => {
        observedDelayMs = Date.now() - armedAt
        resolve()
      }, 5)
    })

    const pending = Promise.resolve(new HermesHookService().getStatus())
    void pending.catch(() => {})
    await timer

    expect(observedDelayMs).toBeGreaterThanOrEqual(0)
    expect(observedDelayMs).toBeLessThan(TIMER_BUDGET_MS)
    expect(syncFsCalls).toEqual([])
  })

  it('serializes overlapping installs so config.yaml never renames out of order', async () => {
    const service = new HermesHookService()

    const [first, second] = await Promise.all([service.install(), service.install()])

    expect(first.state).toBe('installed')
    expect(second.state).toBe('installed')
    expect((await service.getStatus()).state).toBe('installed')
  })
})
