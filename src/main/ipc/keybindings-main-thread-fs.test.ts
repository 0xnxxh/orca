// Regression guard for freeze #16: ~/.orca can live on a network home
// directory, where a sync read/write from a keybindings IPC handler blocks the
// Electron main thread and the whole app stops repainting.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeFs from 'node:fs'
import type * as NodeFsPromises from 'node:fs/promises'
import type { KeybindingService } from '../keybindings/keybinding-service'

/** One-shot park on a named fs op, so a test can interleave an overlapping call. */
type FsHold = { op: string; release: Promise<void> }

const { syncFsCalls, asyncFsCalls, gate, RECORDED_SYNC, RECORDED_ASYNC } = vi.hoisted(() => ({
  syncFsCalls: [] as string[],
  asyncFsCalls: [] as string[],
  gate: { block: null as Promise<void> | null, hold: null as FsHold | null },
  RECORDED_SYNC: [
    'accessSync',
    'existsSync',
    'mkdirSync',
    'readFileSync',
    'renameSync',
    'statSync',
    'unlinkSync',
    'writeFileSync'
  ] as const,
  RECORDED_ASYNC: ['mkdir', 'readFile', 'rename', 'unlink', 'writeFile'] as const
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof NodeFs>('node:fs')
  const patched: Record<string, unknown> = { ...actual }
  for (const name of RECORDED_SYNC) {
    const real = actual[name] as (...args: unknown[]) => unknown
    patched[name] = (...args: unknown[]) => {
      syncFsCalls.push(`${name} ${String(args[0])}`)
      return real(...args)
    }
  }
  return patched
})

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
  const patched: Record<string, unknown> = { ...actual }
  for (const name of RECORDED_ASYNC) {
    const real = actual[name] as (...args: unknown[]) => Promise<unknown>
    patched[name] = async (...args: unknown[]) => {
      asyncFsCalls.push(`${name} ${String(args[0])}`)
      const hold = gate.hold
      if (hold?.op === name) {
        // The syscall sees the pre-write state; only its resolution is delayed.
        gate.hold = null
        try {
          return await real(...args)
        } finally {
          await hold.release
        }
      }
      if (gate.block) {
        await gate.block
      }
      return real(...args)
    }
  }
  return patched
})

const handlers = new Map<string, (event: unknown, args?: unknown) => unknown>()

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    })
  },
  shell: { openPath: vi.fn(async () => ''), showItemInFolder: vi.fn() }
}))

vi.mock('./filesystem-auth', () => ({ authorizeExternalPath: vi.fn() }))
vi.mock('../menu/register-app-menu', () => ({ rebuildAppMenu: vi.fn() }))

async function setup(home: string): Promise<KeybindingService> {
  vi.resetModules()
  handlers.clear()
  const { KeybindingService } = await import('../keybindings/keybinding-service')
  const { registerKeybindingHandlers } = await import('./keybindings')
  // The constructor is the sanctioned sync bootstrap: it runs pre-window.
  const service = new KeybindingService({ homePath: home, platform: 'linux' })
  registerKeybindingHandlers(service)
  return service
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function invoke(channel: string, args?: unknown): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new Error(`no handler for ${channel}`)
  }
  return Promise.resolve(handler(null, args))
}

describe('keybinding IPC handlers stay off main-thread sync fs', () => {
  let home: string
  let service: KeybindingService

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'orca-keybindings-freeze-'))
    gate.block = null
    gate.hold = null
    service = await setup(home)
    syncFsCalls.length = 0
    asyncFsCalls.length = 0
  })

  afterEach(() => {
    gate.block = null
    gate.hold = null
    rmSync(home, { recursive: true, force: true })
  })

  it('serves keybindings:get from the warm snapshot with no fs call', async () => {
    await expect(invoke('keybindings:get')).resolves.toMatchObject({ platform: 'linux' })
    expect(syncFsCalls).toEqual([])
  })

  it('reloads without a synchronous fs call', async () => {
    await expect(invoke('keybindings:reload')).resolves.toMatchObject({ platform: 'linux' })
    expect(syncFsCalls).toEqual([])
  })

  it('creates the keybindings file without a synchronous fs call', async () => {
    const snapshot = (await invoke('keybindings:ensureFile')) as { exists: boolean }
    expect(snapshot.exists).toBe(true)
    expect(syncFsCalls).toEqual([])
  })

  it('creates the keybindings file through a temp file, never in place', async () => {
    const path = join(home, '.orca', 'keybindings.json')

    await invoke('keybindings:ensureFile')

    // A torn in-place write leaves unparseable JSON at the real path, and every
    // later write then refuses to replace a file it could not parse.
    expect(asyncFsCalls).not.toContain(`writeFile ${path}`)
    expect(asyncFsCalls).toContain(`writeFile ${path}.async.tmp`)
    expect(asyncFsCalls).toContain(`rename ${path}.async.tmp`)
  })

  it('does not let an overlapping reload install the pre-write snapshot', async () => {
    await invoke('keybindings:ensureFile')
    let releaseRead = (): void => {}
    gate.hold = {
      op: 'readFile',
      release: new Promise<void>((resolve) => {
        releaseRead = resolve
      })
    }

    const reloaded = service.reloadAsync()
    const written = service.setActionBindingsAsync('terminal.search', ['Ctrl+Shift+F'])
    // Release once the write settles; the timeout keeps the ordered
    // implementation (where the write queues behind the reload) from deadlocking.
    void Promise.race([written.catch(() => {}), delay(50)]).then(releaseRead)
    await Promise.all([reloaded, written])

    expect(service.getSnapshot().overrides['terminal.search']).toEqual(['Ctrl+Shift+F'])
  })

  it('writes a shortcut override without a synchronous fs call', async () => {
    const snapshot = (await invoke('keybindings:setAction', {
      actionId: 'terminal.search',
      bindings: ['Ctrl+Shift+F']
    })) as { overrides: Record<string, string[]> }

    expect(snapshot.overrides['terminal.search']).toEqual(['Ctrl+Shift+F'])
    expect(syncFsCalls).toEqual([])
  })

  it('serializes overlapping shortcut writes so neither override is lost', async () => {
    await Promise.all([
      invoke('keybindings:setAction', { actionId: 'terminal.search', bindings: ['Ctrl+Shift+F'] }),
      invoke('keybindings:setAction', { actionId: 'view.tasks', bindings: ['Ctrl+Alt+T'] })
    ])

    const snapshot = (await invoke('keybindings:reload')) as {
      overrides: Record<string, string[]>
    }
    expect(snapshot.overrides['terminal.search']).toEqual(['Ctrl+Shift+F'])
    expect(snapshot.overrides['view.tasks']).toEqual(['Ctrl+Alt+T'])
  })

  it('keeps the event loop running while a keybindings write is parked', async () => {
    gate.block = new Promise<void>(() => {})

    let settled = false
    void invoke('keybindings:setAction', {
      actionId: 'terminal.search',
      bindings: ['Ctrl+Shift+F']
    }).then(() => {
      settled = true
    })

    let timerFired = false
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        timerFired = true
        resolve()
      }, 5)
    })

    expect(timerFired).toBe(true)
    expect(settled).toBe(false)
    expect(syncFsCalls).toEqual([])
  })
})
