import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Why: freeze #28. Devin's JSONC reader ran existsSync + readFileSync on the
// Electron main thread; a stalled ~/.config/devin mount froze the whole app.
const {
  syncFsCalls,
  hangReads,
  homedirMock,
  stalledRoot,
  STALLED_MOUNT_BLOCK_MS,
  TIMER_BUDGET_MS
} = vi.hoisted(() => ({
  syncFsCalls: [] as string[],
  hangReads: { value: false },
  homedirMock: vi.fn<() => string>(),
  stalledRoot: { value: '' },
  STALLED_MOUNT_BLOCK_MS: 1_000,
  TIMER_BUDGET_MS: 500
}))

vi.mock('node:os', async () => {
  const actual = (await vi.importActual('node:os')) as Record<string, unknown>
  return { ...actual, default: { ...actual, homedir: homedirMock }, homedir: homedirMock }
})

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

import { readDevinHooksConfig } from './hook-config-json'
import { DevinHookService } from './hook-service'
import { getDevinConfigPath } from './hook-settings'

describe('Devin config read main-thread fs', () => {
  let homeDir: string

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'orca-devin-sync-fs-'))
    homedirMock.mockReturnValue(homeDir)
    vi.stubEnv('APPDATA', join(homeDir, 'AppData', 'Roaming'))
    hangReads.value = false
    stalledRoot.value = homeDir
  })

  afterEach(() => {
    hangReads.value = false
    stalledRoot.value = ''
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    rmSync(homeDir, { recursive: true, force: true })
  })

  it('reads a present config without a synchronous fs syscall', async () => {
    const configPath = getDevinConfigPath()
    mkdirSync(join(configPath, '..'), { recursive: true })
    writeFileSync(configPath, '{ /* devin */ "hooks": {} }\n', 'utf-8')

    syncFsCalls.length = 0
    const config = await readDevinHooksConfig(configPath)

    expect(config).toEqual({ hooks: {} })
    expect(syncFsCalls).toEqual([])
  })

  it('treats a missing config as empty without a synchronous fs syscall', async () => {
    syncFsCalls.length = 0
    const config = await readDevinHooksConfig(getDevinConfigPath())

    expect(config).toEqual({})
    expect(syncFsCalls).toEqual([])
  })

  it('reads status without a synchronous fs syscall', async () => {
    syncFsCalls.length = 0
    await new DevinHookService().getStatus()

    expect(syncFsCalls).toEqual([])
  })

  it('installs and removes without a single synchronous fs syscall', async () => {
    const service = new DevinHookService()

    syncFsCalls.length = 0
    expect((await service.install()).state).toBe('installed')
    expect(syncFsCalls).toEqual([])

    syncFsCalls.length = 0
    expect((await service.remove()).state).toBe('not_installed')
    expect(syncFsCalls).toEqual([])
  })

  // Why: the point of the async conversion is that a stalled Devin config dir
  // still lets timers/repaints/menus run. Arm the timer *before* the call — a
  // sync reader blocks inside getStatus(), so later lateness misses it.
  it('keeps the event loop alive while config.json reads hang', async () => {
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

    const pending = Promise.resolve(new DevinHookService().getStatus())
    void pending.catch(() => {})
    await timer

    expect(observedDelayMs).toBeGreaterThanOrEqual(0)
    expect(observedDelayMs).toBeLessThan(TIMER_BUDGET_MS)
    expect(syncFsCalls).toEqual([])
  })

  it('serializes overlapping installs so config.json never writes out of order', async () => {
    const service = new DevinHookService()

    const results = await Promise.all([service.install(), service.install()])

    expect(results.map((status) => status.state)).toEqual(['installed', 'installed'])
  })
})
