import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Why: freeze #19. Grok account status read auth.json with existsSync + readFileSync on
// the Electron main thread — and RateLimitService still calls the sync twin on its poll
// timer, so a stalled GROK_HOME froze the app with no user action at all.
const { syncFsCalls, hangReads } = vi.hoisted(() => ({
  syncFsCalls: [] as string[],
  hangReads: { value: false }
}))

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

import { readGrokAuthSession, readGrokAuthSessionAsync, toGrokAccountStatus } from './grok-auth'

const FUTURE_EXPIRY = new Date(Date.now() + 60 * 60 * 1000).toISOString()

describe('grok auth reads off the main thread', () => {
  let grokHome: string
  let previousGrokHome: string | undefined

  beforeEach(() => {
    grokHome = mkdtempSync(join(tmpdir(), 'orca-grok-home-'))
    previousGrokHome = process.env.GROK_HOME
    process.env.GROK_HOME = grokHome
    hangReads.value = false
    syncFsCalls.length = 0
  })

  afterEach(() => {
    hangReads.value = false
    if (previousGrokHome === undefined) {
      delete process.env.GROK_HOME
    } else {
      process.env.GROK_HOME = previousGrokHome
    }
    rmSync(grokHome, { recursive: true, force: true })
  })

  function writeAuthJson(): void {
    writeFileSync(
      join(grokHome, 'auth.json'),
      JSON.stringify({
        'https://auth.x.ai': {
          key: 'token-1',
          email: 'pilot@x.ai',
          team_id: 'team-1',
          expires_at: FUTURE_EXPIRY
        }
      }),
      'utf-8'
    )
    syncFsCalls.length = 0
  }

  it('resolves the account status without a single synchronous fs syscall', async () => {
    writeAuthJson()

    const status = toGrokAccountStatus(await readGrokAuthSessionAsync())
    const recorded = [...syncFsCalls]

    expect(recorded).toEqual([])
    expect(status).toEqual({
      signedIn: true,
      email: 'pilot@x.ai',
      teamId: 'team-1',
      tokenFresh: true,
      error: null
    })
  })

  it('reports signed out asynchronously when auth.json is missing', async () => {
    expect(toGrokAccountStatus(await readGrokAuthSessionAsync())).toEqual({
      signedIn: false,
      email: null,
      teamId: null,
      tokenFresh: false,
      error: null
    })
    expect(syncFsCalls).toEqual([])
  })

  it('keeps the event loop alive while the auth read hangs', async () => {
    writeAuthJson()
    hangReads.value = true

    const pending = readGrokAuthSessionAsync()
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

  // The timer-driven sync twin keeps its existsSync gate: an unreachable auth path is
  // "signed out", and dropping the gate turned that into a status-bar error alert.
  it('keeps reporting missing (not error) from the sync twin when auth.json is unreachable', () => {
    writeAuthJson()

    expect(readGrokAuthSession().status).toBe('ok')
    expect(syncFsCalls).toEqual([
      `existsSync:${join(grokHome, 'auth.json')}`,
      `readFileSync:${join(grokHome, 'auth.json')}`
    ])

    rmSync(join(grokHome, 'auth.json'))
    syncFsCalls.length = 0
    expect(readGrokAuthSession()).toEqual({ status: 'missing' })
    expect(syncFsCalls).toEqual([`existsSync:${join(grokHome, 'auth.json')}`])
  })
})
