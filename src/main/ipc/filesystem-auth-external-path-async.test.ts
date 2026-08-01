import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../persistence'

const syncFsCalls: string[] = []
const realpathMock = vi.fn<(target: string) => Promise<string>>()

vi.mock('node:fs', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- importOriginal requires inline import()
  const actual = await importOriginal<typeof import('node:fs')>()
  const recorded: Record<string, unknown> = { ...actual }
  for (const name of Object.keys(actual)) {
    if (!name.endsWith('Sync')) {
      continue
    }
    recorded[name] = (...args: unknown[]) => {
      syncFsCalls.push(`${name}(${String(args[0])})`)
      return (actual as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args)
    }
  }
  return recorded
})

vi.mock('node:fs/promises', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- importOriginal requires inline import()
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, realpath: (target: string) => realpathMock(target) }
})

const { authorizeExternalPath, isPathAllowed, resolveAuthorizedPath } =
  await import('./filesystem-auth')

const emptyStore = { getRepos: () => [], getSettings: () => ({}) } as unknown as Store

function deferred(): { promise: Promise<string>; settle: (value: string) => void } {
  let settle: (value: string) => void = () => {}
  const promise = new Promise<string>((fulfill) => {
    settle = fulfill
  })
  return { promise, settle }
}

beforeEach(() => {
  syncFsCalls.length = 0
  realpathMock.mockReset()
})

describe('authorizeExternalPath off the main thread', () => {
  it('canonicalizes without any synchronous fs syscall', async () => {
    const target = resolve('/mnt/stalled-share/notes.md')
    realpathMock.mockResolvedValue(target)

    await authorizeExternalPath(target)

    expect(syncFsCalls).toEqual([])
    expect(realpathMock).toHaveBeenCalledWith(target)
  })

  it('keeps the event loop alive while canonicalization hangs on a stalled mount', async () => {
    const target = resolve('/mnt/stalled-share/hang.md')
    // Never resolves: models an uninterruptible realpath on a dead SMB mount.
    realpathMock.mockReturnValue(new Promise<string>(() => {}))

    const authorization = authorizeExternalPath(target)
    const timerFired = await new Promise<boolean>((fulfill) => {
      setTimeout(() => fulfill(true), 5)
    })

    expect(timerFired).toBe(true)
    expect(syncFsCalls).toEqual([])
    void authorization
  })

  it('authorizes the resolved path synchronously, before canonicalization lands', () => {
    const target = resolve('/mnt/stalled-share/drag-drop.md')
    realpathMock.mockReturnValue(new Promise<string>(() => {}))

    // No await: this is the ordering the next ipc read depends on.
    void authorizeExternalPath(target)

    expect(isPathAllowed(target, emptyStore)).toBe(true)
  })

  it('does not deny a follow-up read that races the pending canonicalization', async () => {
    const target = resolve('/tmp/orca-race/report.md')
    const canonical = resolve('/private/tmp/orca-race/report.md')
    const pending = deferred()
    let authorizationRealpathPending = true
    realpathMock.mockImplementation((path) => {
      if (path === target && authorizationRealpathPending) {
        authorizationRealpathPending = false
        return pending.promise
      }
      return Promise.resolve(canonical)
    })

    // ipcMain.handle cannot await this, so the canonical form lands late.
    void authorizeExternalPath(target)
    const read = resolveAuthorizedPath(target, emptyStore)
    setTimeout(() => pending.settle(canonical), 0)

    await expect(read).resolves.toBe(canonical)
  })
})
