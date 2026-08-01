import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Why: freeze #31. Kimi's config.toml reader ran existsSync + readFileSync on the
// Electron main thread; a stalled ~/.kimi-code mount froze the whole app.
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

import { KimiHookService } from './hook-service'

describe('KimiHookService main-thread fs', () => {
  let home: string
  let kimiHome: string
  let originalHome: string | undefined
  let originalKimiHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'orca-kimi-sync-fs-'))
    kimiHome = join(home, '.kimi-code')
    originalHome = process.env.HOME
    originalKimiHome = process.env.KIMI_CODE_HOME
    process.env.HOME = home
    process.env.KIMI_CODE_HOME = kimiHome
    hangReads.value = false
    stalledRoot.value = home
  })

  afterEach(() => {
    hangReads.value = false
    stalledRoot.value = ''
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
    if (originalKimiHome === undefined) {
      delete process.env.KIMI_CODE_HOME
    } else {
      process.env.KIMI_CODE_HOME = originalKimiHome
    }
    rmSync(home, { recursive: true, force: true })
  })

  it('reads status without a single synchronous fs syscall', async () => {
    mkdirSync(kimiHome, { recursive: true })
    writeFileSync(join(kimiHome, 'config.toml'), 'model = "k2"\n', 'utf-8')

    syncFsCalls.length = 0
    await new KimiHookService().getStatus()

    expect(syncFsCalls).toEqual([])
  })

  it('installs and removes without a single synchronous fs syscall', async () => {
    const service = new KimiHookService()

    syncFsCalls.length = 0
    expect((await service.install()).state).toBe('installed')
    expect(syncFsCalls).toEqual([])

    syncFsCalls.length = 0
    expect((await service.remove()).state).toBe('not_installed')
    expect(syncFsCalls).toEqual([])
  })

  // Why: the point of the async conversion is that a stalled ~/.kimi-code still
  // lets timers/repaints/menus run. Arm the timer *before* the call — a sync
  // reader blocks inside getStatus(), so lateness measured afterwards misses it.
  it('keeps the event loop alive while config.toml reads hang', async () => {
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

    const pending = Promise.resolve(new KimiHookService().getStatus())
    void pending.catch(() => {})
    await timer

    expect(observedDelayMs).toBeGreaterThanOrEqual(0)
    expect(observedDelayMs).toBeLessThan(TIMER_BUDGET_MS)
    expect(syncFsCalls).toEqual([])
  })

  it('serializes overlapping installs so config.toml never renames out of order', async () => {
    const service = new KimiHookService()

    const results = await Promise.all([service.install(), service.install()])

    expect(results.map((status) => status.state)).toEqual(['installed', 'installed'])
    expect((await service.getStatus()).state).toBe('installed')
  })
})
