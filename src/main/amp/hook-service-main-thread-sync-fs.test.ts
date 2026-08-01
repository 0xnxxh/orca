import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

// Why: freeze #32. The Amp plugin probe ran existsSync + readFileSync against
// ~/.config/amp on the Electron main thread; a stalled mount froze the whole app.
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

import { AmpHookService, _internals } from './hook-service'

describe('AmpHookService main-thread fs', () => {
  let homeDir: string

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'orca-amp-sync-fs-'))
    homedirMock.mockReturnValue(homeDir)
    hangReads.value = false
    stalledRoot.value = homeDir
  })

  afterEach(() => {
    hangReads.value = false
    stalledRoot.value = ''
    vi.clearAllMocks()
    rmSync(homeDir, { recursive: true, force: true })
  })

  it('reads status without a single synchronous fs syscall', async () => {
    const pluginPath = _internals.getPluginPath()
    mkdirSync(dirname(pluginPath), { recursive: true })
    writeFileSync(pluginPath, `// ${_internals.AMP_PLUGIN_MARKER}\n`, 'utf-8')

    syncFsCalls.length = 0
    await new AmpHookService().getStatus()

    expect(syncFsCalls).toEqual([])
  })

  it('installs and removes without a single synchronous fs syscall', async () => {
    const service = new AmpHookService()

    syncFsCalls.length = 0
    expect((await service.install()).state).toBe('installed')
    expect(syncFsCalls).toEqual([])

    syncFsCalls.length = 0
    expect((await service.remove()).state).toBe('not_installed')
    expect(syncFsCalls).toEqual([])
  })

  // Why: the point of the async conversion is that a stalled ~/.config/amp still
  // lets timers/repaints/menus run. Arm the timer *before* the call — a sync
  // reader blocks inside getStatus(), so lateness measured afterwards misses it.
  it('keeps the event loop alive while the plugin read hangs', async () => {
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

    const pending = Promise.resolve(new AmpHookService().getStatus())
    void pending.catch(() => {})
    await timer

    expect(observedDelayMs).toBeGreaterThanOrEqual(0)
    expect(observedDelayMs).toBeLessThan(TIMER_BUDGET_MS)
    expect(syncFsCalls).toEqual([])
  })

  it('serializes overlapping installs so the plugin never renames out of order', async () => {
    const service = new AmpHookService()

    const results = await Promise.all([service.install(), service.install()])

    expect(results.map((status) => status.state)).toEqual(['installed', 'installed'])
  })
})
