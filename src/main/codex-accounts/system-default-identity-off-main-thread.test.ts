import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Why: freeze #18. `codexAccounts:list` resolved the live ~/.codex/auth.json identity
// with readFileSync on the Electron main thread; a stalled HOME froze the whole app.
const { syncFsCalls, hangReads, testState } = vi.hoisted(() => ({
  syncFsCalls: [] as string[],
  hangReads: { value: false },
  testState: { fakeHomeDir: '', userDataDir: '' }
}))

vi.mock('electron', () => ({ app: { getPath: () => testState.userDataDir } }))

vi.mock('node:os', async () => {
  const actual = (await vi.importActual('node:os')) as Record<string, unknown>
  const homedir = (): string => testState.fakeHomeDir
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
  const readFile = (...args: Parameters<typeof actual.readFile>): Promise<unknown> =>
    hangReads.value ? new Promise<never>(() => {}) : actual.readFile(...args)
  return { ...actual, default: { ...actual, readFile }, readFile }
})

import { CodexAccountService } from './service'

function createService(): CodexAccountService {
  const settings = {
    codexManagedAccounts: [],
    activeCodexManagedAccountId: null,
    activeCodexManagedAccountIdsByRuntime: { host: null, wsl: {} }
  }
  const store = {
    getSettings: vi.fn(() => settings),
    updateSettings: vi.fn(() => settings),
    getCodexResetCreditAttemptLedger: vi.fn(() => ({ version: 1, attempts: [] })),
    replaceCodexResetCreditAttemptLedgerAndFlush: vi.fn()
  }
  const rateLimits = { refreshForCodexAccountChange: vi.fn(), evictInactiveCodexCache: vi.fn() }
  const runtimeHome = {
    syncForCurrentSelection: vi.fn(),
    clearLastWrittenAuthJson: vi.fn(),
    prepareForRateLimitFetch: vi.fn(() => null)
  }
  return new CodexAccountService(store as never, rateLimits as never, runtimeHome as never)
}

function writeSystemAuthJson(contents: string): void {
  mkdirSync(join(testState.fakeHomeDir, '.codex'), { recursive: true })
  writeFileSync(join(testState.fakeHomeDir, '.codex', 'auth.json'), contents, 'utf-8')
}

describe('codex system-default identity off the main thread', () => {
  beforeEach(() => {
    testState.fakeHomeDir = mkdtempSync(join(tmpdir(), 'orca-codex-home-'))
    testState.userDataDir = mkdtempSync(join(tmpdir(), 'orca-codex-userdata-'))
    hangReads.value = false
  })

  afterEach(() => {
    hangReads.value = false
    rmSync(testState.fakeHomeDir, { recursive: true, force: true })
    rmSync(testState.userDataDir, { recursive: true, force: true })
  })

  it('lists accounts without a single synchronous fs syscall', async () => {
    writeSystemAuthJson(JSON.stringify({ OPENAI_API_KEY: 'sk-live-test' }))
    const service = createService()

    syncFsCalls.length = 0
    const state = await service.listAccountsAsync()
    const recorded = [...syncFsCalls]

    expect(recorded).toEqual([])
    expect(state.systemDefault).toEqual({
      hasAuth: true,
      authKind: 'api-key',
      email: null,
      providerAccountId: null,
      workspaceLabel: null
    })
  })

  it('reports a signed-out home when auth.json is missing', async () => {
    const service = createService()
    delete process.env.OPENAI_API_KEY

    syncFsCalls.length = 0
    const state = await service.listAccountsAsync()

    expect(syncFsCalls).toEqual([])
    expect(state.systemDefault).toMatchObject({ hasAuth: false, authKind: 'none' })
  })

  it('keeps the event loop alive while the auth read hangs', async () => {
    writeSystemAuthJson(JSON.stringify({ OPENAI_API_KEY: 'sk-live-test' }))
    const service = createService()
    hangReads.value = true

    syncFsCalls.length = 0
    const pending = service.listAccountsAsync()
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
