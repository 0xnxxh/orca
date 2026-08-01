import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Why: freezes #20/#42/#43. MiniMax status/save/clear ran existsSync + the secure-file
// stat/chmod pair on the Electron main thread; a stalled ~/.orca mount froze the app.
const { syncFsCalls, hangFs, testState, safeStorageMock } = vi.hoisted(() => ({
  syncFsCalls: [] as string[],
  hangFs: { value: false },
  testState: { homeDir: '' },
  safeStorageMock: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(value)),
    decryptString: vi.fn((value: Buffer) => value.toString('utf8'))
  }
}))

vi.mock('electron', () => ({ safeStorage: safeStorageMock }))

vi.mock('node:os', async () => {
  const actual = (await vi.importActual('node:os')) as Record<string, unknown>
  const homedir = (): string => testState.homeDir
  return { ...actual, default: { ...actual, homedir }, homedir }
})

vi.mock('node:fs', async () => {
  const actual = (await vi.importActual('node:fs')) as Record<string, unknown>
  const wrapped: Record<string, unknown> = { ...actual }
  for (const [name, value] of Object.entries(actual)) {
    if (name.endsWith('Sync') && typeof value === 'function') {
      wrapped[name] = (...args: unknown[]) => {
        syncFsCalls.push(`${name}:${String(args[0])}`)
        return (value as (...a: unknown[]) => unknown)(...args)
      }
    }
  }
  return { ...wrapped, default: wrapped }
})

vi.mock('node:fs/promises', async () => {
  const actual = (await vi.importActual('node:fs/promises')) as typeof FsPromises
  const wrapped: Record<string, unknown> = { ...actual }
  for (const name of [
    'mkdir',
    'writeFile',
    'rename',
    'rm',
    'chmod',
    'stat',
    'access',
    'readFile'
  ] as const) {
    const original = actual[name] as (...a: unknown[]) => Promise<unknown>
    wrapped[name] = (...args: unknown[]) =>
      hangFs.value ? new Promise<never>(() => {}) : original(...args)
  }
  return { ...wrapped, default: wrapped }
})

import {
  clearMiniMaxSessionCookieAsync,
  hasMiniMaxSessionCookieAsync,
  readMiniMaxSessionCookieAsync,
  saveMiniMaxSessionCookieAsync
} from './minimax-cookie-store'

const cookiePath = (): string => join(testState.homeDir, '.orca', 'minimax-session-cookie.enc')

describe('minimax cookie store off the main thread', () => {
  beforeEach(() => {
    testState.homeDir = mkdtempSync(join(tmpdir(), 'orca-minimax-async-'))
    hangFs.value = false
    syncFsCalls.length = 0
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
  })

  afterEach(() => {
    hangFs.value = false
    // Why: not awaited — a clear queued behind a hung write never settles, by design.
    // The cache reset it exists for happens synchronously at call time.
    void clearMiniMaxSessionCookieAsync().catch(() => undefined)
    rmSync(testState.homeDir, { recursive: true, force: true })
  })

  it('saves, reports and clears the cookie without a single synchronous fs syscall', async () => {
    await saveMiniMaxSessionCookieAsync('_token=abc; minimax_group_id_v2=42')
    await expect(hasMiniMaxSessionCookieAsync()).resolves.toBe(true)
    const afterSave = [...syncFsCalls]

    expect(afterSave).toEqual([])
    if (process.platform !== 'win32') {
      expect(statSync(cookiePath()).mode & 0o777).toBe(0o600)
    }

    syncFsCalls.length = 0
    await clearMiniMaxSessionCookieAsync()
    const afterClear = [...syncFsCalls]

    expect(afterClear).toEqual([])
    await expect(hasMiniMaxSessionCookieAsync()).resolves.toBe(false)
    await expect(readMiniMaxSessionCookieAsync()).resolves.toBeNull()
  })

  it('serializes an overlapping save and clear so the cleared cookie cannot survive', async () => {
    const save = saveMiniMaxSessionCookieAsync('_token=abc')
    const clear = clearMiniMaxSessionCookieAsync()
    await Promise.all([save, clear])

    // Both layers: a bare rm unlinks before the save's rename republishes the file,
    // and the save's cache write lands after the clear nulled it.
    expect(existsSync(cookiePath())).toBe(false)
    await expect(readMiniMaxSessionCookieAsync()).resolves.toBeNull()
  })

  it('keeps the event loop alive while the cookie write hangs', async () => {
    hangFs.value = true
    syncFsCalls.length = 0

    const pending = saveMiniMaxSessionCookieAsync('_token=abc')
    void pending.catch(() => {})

    let timerFired = false
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        timerFired = true
        resolve()
      }, 10)
    })

    expect(timerFired).toBe(true)
    expect(syncFsCalls).toEqual([])
  })
})
