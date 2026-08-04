import { join } from 'node:path'
import { homedir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import {
  CODEX_HOME_PROCESS_LOCK_MAX_HOLD_MS,
  resolveCodexHomeProcessLockKey,
  resolveCodexHomeProcessLockKeyForSpawnEnv,
  withCodexHomeProcessLock
} from './codex-home-process-lock'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('withCodexHomeProcessLock', () => {
  it('serializes runs that share a lock key', async () => {
    const events: string[] = []
    const firstGate = deferred()

    const first = withCodexHomeProcessLock('home-a', async () => {
      events.push('first:start')
      await firstGate.promise
      events.push('first:end')
      return 1
    })
    const second = withCodexHomeProcessLock('home-a', async () => {
      events.push('second:start')
      return 2
    })

    await Promise.resolve()
    expect(events).toEqual(['first:start'])

    firstGate.resolve()
    await expect(first).resolves.toBe(1)
    await expect(second).resolves.toBe(2)
    expect(events).toEqual(['first:start', 'first:end', 'second:start'])
  })

  it('runs different lock keys concurrently', async () => {
    const events: string[] = []
    const firstGate = deferred()

    const first = withCodexHomeProcessLock('home-a', async () => {
      events.push('a:start')
      await firstGate.promise
    })
    const second = withCodexHomeProcessLock('home-b', async () => {
      events.push('b:start')
    })

    await second
    expect(events).toEqual(['a:start', 'b:start'])
    firstGate.resolve()
    await first
  })

  it('releases the lock after a rejected run', async () => {
    await expect(
      withCodexHomeProcessLock('home-a', async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    await expect(withCodexHomeProcessLock('home-a', async () => 'after')).resolves.toBe('after')
  })

  it('releases the lock when a hold never settles', async () => {
    vi.useFakeTimers()
    try {
      const events: string[] = []
      // A codex child whose surviving descendant keeps its stdio open never
      // reports completion, so this hold never settles on its own.
      void withCodexHomeProcessLock('home-wedged', () => new Promise<void>(() => {}))
      const queued = withCodexHomeProcessLock('home-wedged', async () => {
        events.push('queued:start')
      })

      await vi.advanceTimersByTimeAsync(CODEX_HOME_PROCESS_LOCK_MAX_HOLD_MS - 1)
      expect(events).toEqual([])

      await vi.advanceTimersByTimeAsync(1)
      await queued
      expect(events).toEqual(['queued:start'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('measures the release cap from when a run starts, not when it is queued', async () => {
    vi.useFakeTimers()
    try {
      const events: string[] = []
      const gate = deferred()
      const first = withCodexHomeProcessLock('home-queued', async () => {
        events.push('first:start')
        await gate.promise
      })
      void withCodexHomeProcessLock('home-queued', () => new Promise<void>(() => {}))
      const third = withCodexHomeProcessLock('home-queued', async () => {
        events.push('third:start')
      })

      // Time spent waiting behind a healthy run must not burn the wedged run's cap.
      await vi.advanceTimersByTimeAsync(CODEX_HOME_PROCESS_LOCK_MAX_HOLD_MS - 1_000)
      gate.resolve()
      await first
      await vi.advanceTimersByTimeAsync(CODEX_HOME_PROCESS_LOCK_MAX_HOLD_MS - 1)
      expect(events).toEqual(['first:start'])

      await vi.advanceTimersByTimeAsync(1)
      await third
      expect(events).toEqual(['first:start', 'third:start'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('keys explicit and default host homes consistently', () => {
    const previousCodexHome = process.env.CODEX_HOME
    delete process.env.CODEX_HOME
    try {
      const defaultKey = resolveCodexHomeProcessLockKey(null)
      expect(resolveCodexHomeProcessLockKey(join(homedir(), '.codex'))).toBe(defaultKey)
      expect(resolveCodexHomeProcessLockKeyForSpawnEnv(undefined)).toBe(defaultKey)
      expect(resolveCodexHomeProcessLockKey('/somewhere/else')).not.toBe(defaultKey)
    } finally {
      if (previousCodexHome !== undefined) {
        process.env.CODEX_HOME = previousCodexHome
      }
    }
  })

  it('keys a stripped child env to the real default home, not ambient CODEX_HOME', () => {
    const previousCodexHome = process.env.CODEX_HOME
    process.env.CODEX_HOME = '/nested-orca/managed-home'
    try {
      expect(resolveCodexHomeProcessLockKeyForSpawnEnv({ PATH: process.env.PATH })).toBe(
        resolveCodexHomeProcessLockKey(join(homedir(), '.codex'))
      )
      expect(resolveCodexHomeProcessLockKeyForSpawnEnv(undefined)).toBe(
        resolveCodexHomeProcessLockKey('/nested-orca/managed-home')
      )
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME
      } else {
        process.env.CODEX_HOME = previousCodexHome
      }
    }
  })

  it('keys a WSL UNC probe home and a WSL spawn env to the same lock', () => {
    const probeKey = resolveCodexHomeProcessLockKey('\\\\wsl$\\Ubuntu\\home\\user\\.codex')
    const spawnKey = resolveCodexHomeProcessLockKeyForSpawnEnv(
      { CODEX_HOME: '/home/user/.codex' },
      'Ubuntu'
    )
    expect(spawnKey).toBe(probeKey)
  })

  it('uses the WSL default sentinel when launcher filtering strips an ambient home', () => {
    const previousCodexHome = process.env.CODEX_HOME
    process.env.CODEX_HOME = '/host-only/codex-home'
    try {
      const inheritedKey = resolveCodexHomeProcessLockKeyForSpawnEnv(
        { CODEX_HOME: '/host-only/codex-home' },
        'Ubuntu'
      )
      const strippedKey = resolveCodexHomeProcessLockKeyForSpawnEnv({}, 'Ubuntu')
      expect(inheritedKey).toBe(strippedKey)
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME
      } else {
        process.env.CODEX_HOME = previousCodexHome
      }
    }
  })
})
