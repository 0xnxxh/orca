import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Why: freeze #33. Saving/clearing the OpenAI speech key ran mkdirSync + writeFileSync
// on the Electron main thread; a stalled ~/.orca mount froze the app mid-settings.
const { syncFsCalls, hangWrites, testState, safeStorageMock } = vi.hoisted(() => ({
  syncFsCalls: [] as string[],
  hangWrites: { value: false },
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
  for (const name of ['mkdir', 'writeFile', 'rm', 'access'] as const) {
    const original = actual[name] as (...a: unknown[]) => Promise<unknown>
    wrapped[name] = (...args: unknown[]) =>
      hangWrites.value ? new Promise<never>(() => {}) : original(...args)
  }
  return { ...wrapped, default: wrapped }
})

import {
  clearOpenAiSpeechApiKeyAsync,
  hasOpenAiSpeechApiKeyAsync,
  readOpenAiSpeechApiKey,
  saveOpenAiSpeechApiKeyAsync
} from './openai-api-key-store'

const keyPath = (): string => join(testState.homeDir, '.orca', 'openai-speech-token.enc')

describe('openai speech key store off the main thread', () => {
  beforeEach(() => {
    testState.homeDir = mkdtempSync(join(tmpdir(), 'orca-openai-key-async-'))
    hangWrites.value = false
    syncFsCalls.length = 0
  })

  afterEach(() => {
    hangWrites.value = false
    rmSync(testState.homeDir, { recursive: true, force: true })
  })

  it('saves, reports and clears the key without a single synchronous fs syscall', async () => {
    await saveOpenAiSpeechApiKeyAsync('sk-test-key')
    await expect(hasOpenAiSpeechApiKeyAsync()).resolves.toBe(true)
    const afterSave = [...syncFsCalls]

    expect(afterSave).toEqual([])
    if (process.platform !== 'win32') {
      // Mode on the CREATE — the key must never exist world-readable, even briefly.
      expect(statSync(keyPath()).mode & 0o777).toBe(0o600)
    }

    syncFsCalls.length = 0
    await clearOpenAiSpeechApiKeyAsync()
    const afterClear = [...syncFsCalls]

    expect(afterClear).toEqual([])
    await expect(hasOpenAiSpeechApiKeyAsync()).resolves.toBe(false)
  })

  it('serializes an overlapping save and clear so the clear cannot land first', async () => {
    const save = saveOpenAiSpeechApiKeyAsync('sk-test-key')
    const clear = clearOpenAiSpeechApiKeyAsync()
    await Promise.all([save, clear])

    expect(existsSync(keyPath())).toBe(false)
    await expect(hasOpenAiSpeechApiKeyAsync()).resolves.toBe(false)
    // Disk alone is not enough: the in-memory cache is what SttService hands to the
    // cloud session, so a cleared key surviving there is still a live credential.
    expect(() => readOpenAiSpeechApiKey()).toThrow(/not configured/)
  })

  it('keeps the event loop alive while the key write hangs', async () => {
    hangWrites.value = true
    syncFsCalls.length = 0

    const pending = saveOpenAiSpeechApiKeyAsync('sk-test-key')
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
