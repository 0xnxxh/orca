import { describe, expect, it, vi } from 'vitest'
import {
  DEGRADED_DAEMON_RECOVERY_RETRY_MS,
  DegradedDaemonFreshSpawnRouter
} from './degraded-daemon-fresh-spawn-routing'
import type { IPtyProvider, PtySpawnResult } from '../providers/types'

function provider(id: string, spawn?: IPtyProvider['spawn']): IPtyProvider {
  return {
    spawn: spawn ?? vi.fn(async () => ({ id: `${id}-pty` }) as PtySpawnResult)
  } as unknown as IPtyProvider
}

function router(opts: {
  probe?: (() => Promise<boolean>) | null
  currentSpawn?: IPtyProvider['spawn']
}) {
  const current = provider('current', opts.currentSpawn)
  const fallback = provider('fallback')
  const sessionProviders = new Map<string, IPtyProvider>()
  return {
    current,
    fallback,
    sessionProviders,
    router: new DegradedDaemonFreshSpawnRouter(
      current,
      fallback,
      sessionProviders,
      opts.probe === undefined ? async () => true : opts.probe
    )
  }
}

describe('DegradedDaemonFreshSpawnRouter', () => {
  it('starts on the fallback, so a held daemon never receives a fresh spawn', () => {
    expect(router({}).router.routesToFallback).toBe(true)
  })

  it('promotes fresh spawns back to the daemon once it answers a health check', async () => {
    const { router: r } = router({ probe: async () => true })

    await expect(r.recover()).resolves.toBe(true)
    expect(r.routesToFallback).toBeUndefined()
  })

  it('stays on the fallback while the daemon is still unhealthy', async () => {
    const { router: r } = router({ probe: async () => false })

    await expect(r.recover()).resolves.toBe(false)
    expect(r.routesToFallback).toBe(true)
  })

  it('routes back to the fallback when a spawn fails after recovery', async () => {
    // The defect: recovery was a one-way flip on a two-way condition. A daemon that answers one
    // health check and wedges again kept every later fresh spawn pointed at it, and each one
    // costs a hello timeout plus a full launcher re-classification — per terminal, for the rest
    // of the session.
    const wedged = vi.fn(async () => {
      throw new Error('Hello response timed out')
    })
    const { router: r } = router({ probe: async () => true, currentSpawn: wedged })

    await r.recover()
    expect(r.routesToFallback).toBeUndefined()

    await expect(r.spawn({ cwd: '/tmp' } as never)).rejects.toThrow('Hello response timed out')
    expect(r.routesToFallback).toBe(true)
  })

  it('does not immediately re-promote after routing back', async () => {
    // Without re-arming the cooldown the next spawn probes again straight away, and a wedged
    // daemon that still passes a cheap health check would be re-promoted into the same failure.
    const wedged = vi.fn(async () => {
      throw new Error('Hello response timed out')
    })
    const { router: r } = router({ probe: async () => true, currentSpawn: wedged })

    await r.recover()
    await expect(r.spawn({ cwd: '/tmp' } as never)).rejects.toThrow()

    await expect(r.recover()).resolves.toBe(false)
    expect(r.routesToFallback).toBe(true)

    const past = vi
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + DEGRADED_DAEMON_RECOVERY_RETRY_MS + 1)
    try {
      await expect(r.recover()).resolves.toBe(true)
    } finally {
      past.mockRestore()
    }
  })

  it('leaves an explicitly mapped session routed where it is', async () => {
    // A mapped id names the provider that actually owns that pty. Rerouting on its failure would
    // send a daemon-owned session to a provider that does not have it.
    const wedged = vi.fn(async () => {
      throw new Error('Hello response timed out')
    })
    const {
      router: r,
      current,
      sessionProviders
    } = router({
      probe: async () => true,
      currentSpawn: wedged
    })
    sessionProviders.set('session-1', current)
    // Promote first, or the assertion below passes on the constructor's default and proves nothing.
    await r.recover()
    expect(r.routesToFallback).toBeUndefined()

    await expect(r.spawn({ cwd: '/tmp', sessionId: 'session-1' } as never)).rejects.toThrow()
    expect(r.routesToFallback).toBeUndefined()
  })
})
