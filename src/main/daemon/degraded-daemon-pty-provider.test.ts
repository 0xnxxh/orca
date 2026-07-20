import { describe, expect, it, vi } from 'vitest'
import { DegradedDaemonPtyProvider } from './degraded-daemon-pty-provider'
import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import type {
  IPtyProvider,
  PtyProcessInfo,
  PtySpawnOptions,
  PtySpawnResult
} from '../providers/types'

type ProviderMock = IPtyProvider & {
  emitData: (id: string, data: string, sequenceChars?: number) => void
  emitReplay: (id: string, data: string) => void
  emitExit: (id: string, code: number) => void
}

function createProvider(label: string, sessions: string[] = []): ProviderMock {
  const dataListeners: ((payload: { id: string; data: string; sequenceChars?: number }) => void)[] =
    []
  const replayListeners: ((payload: { id: string; data: string }) => void)[] = []
  const exitListeners: ((payload: { id: string; code: number }) => void)[] = []
  return {
    spawn: vi.fn(async (opts: PtySpawnOptions): Promise<PtySpawnResult> => {
      const id = opts.sessionId ?? `${label}-new`
      sessions.push(id)
      return { id }
    }),
    attach: vi.fn(async () => {}),
    hasPty: vi.fn((id: string) => sessions.includes(id)),
    write: vi.fn(),
    resize: vi.fn(),
    shutdown: vi.fn(async (id: string) => {
      const idx = sessions.indexOf(id)
      if (idx !== -1) {
        sessions.splice(idx, 1)
      }
    }),
    sendSignal: vi.fn(async () => {}),
    getCwd: vi.fn(async () => ''),
    getInitialCwd: vi.fn(async () => ''),
    clearBuffer: vi.fn(async () => {}),
    acknowledgeDataEvent: vi.fn(),
    hasChildProcesses: vi.fn(async () => false),
    getForegroundProcess: vi.fn(async () => null),
    confirmForegroundProcess: vi.fn(async () => `${label}-confirmed`),
    serialize: vi.fn(async () => '{}'),
    revive: vi.fn(async () => {}),
    listProcesses: vi.fn(async () => sessions.map((id) => ({ id, cwd: '', title: label }))),
    getDefaultShell: vi.fn(async () => '/bin/zsh'),
    getProfiles: vi.fn(async () => []),
    onData: vi.fn(
      (callback: (payload: { id: string; data: string; sequenceChars?: number }) => void) => {
        dataListeners.push(callback)
        return () => {
          const idx = dataListeners.indexOf(callback)
          if (idx !== -1) {
            dataListeners.splice(idx, 1)
          }
        }
      }
    ),
    onReplay: vi.fn((callback: (payload: { id: string; data: string }) => void) => {
      replayListeners.push(callback)
      return () => {
        const idx = replayListeners.indexOf(callback)
        if (idx !== -1) {
          replayListeners.splice(idx, 1)
        }
      }
    }),
    onExit: vi.fn((callback: (payload: { id: string; code: number }) => void) => {
      exitListeners.push(callback)
      return () => {
        const idx = exitListeners.indexOf(callback)
        if (idx !== -1) {
          exitListeners.splice(idx, 1)
        }
      }
    }),
    emitData: (id: string, data: string, sequenceChars?: number) => {
      for (const listener of dataListeners) {
        listener({ id, data, ...(sequenceChars === undefined ? {} : { sequenceChars }) })
      }
    },
    emitReplay: (id: string, data: string) => {
      for (const listener of replayListeners) {
        listener({ id, data })
      }
    },
    emitExit: (id: string, code: number) => {
      for (const listener of exitListeners) {
        listener({ id, code })
      }
    }
  }
}

function createDaemonAdapter(
  label: string,
  sessions: string[] = []
): DaemonPtyAdapter & ProviderMock {
  return {
    ...createProvider(label, sessions),
    protocolVersion: 13,
    listSessions: vi.fn(async () => []),
    ackColdRestore: vi.fn(),
    clearTombstone: vi.fn(),
    reconcileOnStartup: vi.fn(async () => ({ alive: sessions, killed: [] })),
    dispose: vi.fn(),
    disconnectOnly: vi.fn(async () => {}),
    getActiveSessionIds: vi.fn(() => []),
    fanoutSyntheticExits: vi.fn()
  } as unknown as DaemonPtyAdapter & ProviderMock
}

describe('DegradedDaemonPtyProvider', () => {
  it('routes fresh foreground confirmation to the session owner', async () => {
    const current = createDaemonAdapter('daemon', ['daemon-session'])
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })
    await provider.discoverDaemonSessions()
    const fresh = await provider.spawn({ cols: 80, rows: 24 })

    await expect(provider.confirmForegroundProcess('daemon-session')).resolves.toBe(
      'daemon-confirmed'
    )
    await expect(provider.confirmForegroundProcess(fresh.id)).resolves.toBe('fallback-confirmed')
  })

  it('routes discovered daemon sessions to the daemon and fresh PTYs to the fallback', async () => {
    const current = createDaemonAdapter('daemon', ['daemon-session'])
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })

    await provider.discoverDaemonSessions()

    await provider.spawn({ sessionId: 'daemon-session', cols: 80, rows: 24 })
    const fresh = await provider.spawn({ cols: 80, rows: 24 })
    provider.write('daemon-session', 'old\n')
    provider.write(fresh.id, 'new\n')

    expect(current.spawn).toHaveBeenCalledWith({ sessionId: 'daemon-session', cols: 80, rows: 24 })
    expect(fallback.spawn).toHaveBeenCalledWith({ cols: 80, rows: 24 })
    expect(current.write).toHaveBeenCalledWith('daemon-session', 'old\n')
    expect(fallback.write).toHaveBeenCalledWith(fresh.id, 'new\n')
  })

  it('routes a previously daemon-backed id to fallback after daemon exit removes the mapping', async () => {
    const current = createDaemonAdapter('daemon', ['daemon-session'])
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })

    await provider.discoverDaemonSessions()
    current.emitExit('daemon-session', 0)
    await provider.spawn({ sessionId: 'daemon-session', cols: 80, rows: 24 })

    expect(fallback.spawn).toHaveBeenCalledWith({
      sessionId: 'daemon-session',
      cols: 80,
      rows: 24
    })
  })

  it('caches a provider discovered by hasPty before routing later operations', () => {
    const current = createDaemonAdapter('daemon', ['daemon-session'])
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })

    expect(provider.hasPty('daemon-session')).toBe(true)
    provider.write('daemon-session', 'kept-on-daemon\n')

    expect(current.write).toHaveBeenCalledWith('daemon-session', 'kept-on-daemon\n')
    expect(fallback.write).not.toHaveBeenCalled()
  })

  it('refreshes recovered daemon routing after startup discovery transiently fails', async () => {
    const current = createDaemonAdapter('daemon', ['recovered-session'])
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(current.listProcesses).mockRejectedValueOnce(new Error('daemon still starting'))

    await provider.discoverDaemonSessions()
    await provider.listProcesses({ deadlineMs: Date.now() + 1000 })
    await provider.shutdown('recovered-session', {
      immediate: true,
      deadlineMs: Date.now() + 1000
    })

    expect(current.shutdown).toHaveBeenCalledWith('recovered-session', {
      immediate: true,
      deadlineMs: expect.any(Number)
    })
    expect(fallback.shutdown).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('does not restore a daemon route from an inventory response older than exit', async () => {
    const current = createDaemonAdapter('daemon', ['exited-session'])
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })
    await provider.discoverDaemonSessions()
    let resolveDaemon!: (sessions: PtyProcessInfo[]) => void
    vi.mocked(current.listProcesses).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDaemon = resolve
      })
    )

    const listing = provider.listProcesses()
    current.emitExit('exited-session', 0)
    resolveDaemon([{ id: 'exited-session', cwd: '', title: 'stale daemon' }])
    await listing
    await provider.spawn({ sessionId: 'exited-session', cols: 80, rows: 24 })

    expect(fallback.spawn).toHaveBeenCalledWith({
      sessionId: 'exited-session',
      cols: 80,
      rows: 24
    })
    expect(current.spawn).not.toHaveBeenCalled()
  })

  it('fails shutdown closed for duplicate ownership across degraded daemons', async () => {
    const current = createDaemonAdapter('current', ['duplicate-session'])
    const legacy = createDaemonAdapter('legacy', ['duplicate-session'])
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [legacy], fallback })

    await provider.discoverDaemonSessions()

    await expect(
      provider.shutdown('duplicate-session', {
        immediate: true
      })
    ).rejects.toThrow(
      'Ambiguous PTY session ownership across degraded providers: duplicate-session'
    )
    await expect(provider.listProcesses({ deadlineMs: Date.now() + 1000 })).rejects.toThrow(
      'Ambiguous PTY session ownership across degraded providers: duplicate-session'
    )
    expect(current.shutdown).not.toHaveBeenCalled()
    expect(legacy.shutdown).not.toHaveBeenCalled()
    expect(fallback.shutdown).not.toHaveBeenCalled()
  })

  it('fails closed when recovered daemon ownership duplicates a fallback session', async () => {
    const current = createDaemonAdapter('daemon', ['duplicate-session'])
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(current.listProcesses).mockRejectedValueOnce(new Error('daemon still starting'))

    await provider.discoverDaemonSessions()
    await provider.spawn({ sessionId: 'duplicate-session', cols: 80, rows: 24 })

    await expect(provider.listProcesses({ deadlineMs: Date.now() + 1000 })).rejects.toThrow(
      'Ambiguous PTY session ownership across degraded providers: duplicate-session'
    )
    await expect(
      provider.shutdown('duplicate-session', {
        immediate: true
      })
    ).rejects.toThrow(
      'Ambiguous PTY session ownership across degraded providers: duplicate-session'
    )
    expect(current.shutdown).not.toHaveBeenCalled()
    expect(fallback.shutdown).not.toHaveBeenCalled()

    // Why: ambiguity must not erase the local owner needed by daemon-restart cleanup.
    await expect(provider.shutdownFallbackSessions()).resolves.toBe(1)
    expect(fallback.shutdown).toHaveBeenCalledWith('duplicate-session', { immediate: true })
    warn.mockRestore()
  })

  it('discovers an already-live fallback collision before direct shutdown', async () => {
    const current = createDaemonAdapter('daemon', ['duplicate-session'])
    const fallback = createProvider('fallback', ['duplicate-session'])
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })

    await provider.discoverDaemonSessions()

    await expect(provider.shutdown('duplicate-session', { immediate: true })).rejects.toThrow(
      'Ambiguous PTY session ownership across degraded providers: duplicate-session'
    )
    expect(current.shutdown).not.toHaveBeenCalled()
    expect(fallback.shutdown).not.toHaveBeenCalled()
  })

  it('probes every provider before destructive shutdown without startup inventory', async () => {
    const current = createDaemonAdapter('daemon', ['duplicate-session'])
    const fallback = createProvider('fallback', ['duplicate-session'])
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })

    await expect(provider.shutdown('duplicate-session', { immediate: true })).rejects.toThrow(
      'Ambiguous PTY session ownership'
    )
    expect(current.shutdown).not.toHaveBeenCalled()
    expect(fallback.shutdown).not.toHaveBeenCalled()
  })

  it('keeps a daemon inventory result when fallback spawns during the listing', async () => {
    const current = createDaemonAdapter('daemon')
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })
    let resolveDaemon!: (sessions: PtyProcessInfo[]) => void
    vi.mocked(current.listProcesses).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDaemon = resolve
      })
    )

    const listing = provider.listProcesses()
    await provider.spawn({ sessionId: 'duplicate-session', cols: 80, rows: 24 })
    resolveDaemon([{ id: 'duplicate-session', cwd: '', title: 'daemon' }])

    await expect(listing).rejects.toThrow(
      'Ambiguous PTY session ownership across degraded providers: duplicate-session'
    )
    await expect(provider.shutdown('duplicate-session', { immediate: true })).rejects.toThrow(
      'Ambiguous PTY session ownership'
    )
  })

  it('waits for the final fallback owner before forwarding a duplicate exit', async () => {
    const current = createDaemonAdapter('daemon', ['duplicate-session'])
    const fallback = createProvider('fallback', ['duplicate-session'])
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })
    const exitSpy = vi.fn()
    provider.onExit(exitSpy)
    await provider.discoverDaemonSessions()

    current.emitExit('duplicate-session', 0)
    expect(exitSpy).not.toHaveBeenCalled()
    fallback.emitExit('duplicate-session', 0)

    expect(exitSpy).toHaveBeenCalledOnce()
    expect(exitSpy).toHaveBeenCalledWith({ id: 'duplicate-session', code: 0 })
  })

  it('routes authoritative recovery snapshots to the owning daemon', async () => {
    const current = createDaemonAdapter('daemon', ['daemon-session'])
    const fallback = createProvider('fallback')
    const snapshot = {
      data: 'alt frame',
      scrollbackAnsi: 'normal history',
      cols: 80,
      rows: 24,
      seq: 42,
      source: 'headless' as const
    }
    current.getBufferSnapshot = vi.fn(async () => snapshot)
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })

    await provider.discoverDaemonSessions()

    await expect(
      provider.getBufferSnapshot('daemon-session', { scrollbackRows: 50_000 })
    ).resolves.toEqual(snapshot)
    expect(current.getBufferSnapshot).toHaveBeenCalledWith('daemon-session', {
      scrollbackRows: 50_000
    })
  })

  it('forwards replay output from fallback and daemon providers', () => {
    const current = createDaemonAdapter('daemon')
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })
    const replaySpy = vi.fn()

    const unsubscribe = provider.onReplay(replaySpy)
    current.emitReplay('daemon-session', 'daemon replay')
    fallback.emitReplay('fallback-session', 'fallback replay')
    unsubscribe()
    current.emitReplay('daemon-session', 'after unsubscribe')

    expect(replaySpy).toHaveBeenCalledTimes(2)
    expect(replaySpy).toHaveBeenNthCalledWith(1, {
      id: 'daemon-session',
      data: 'daemon replay'
    })
    expect(replaySpy).toHaveBeenNthCalledWith(2, {
      id: 'fallback-session',
      data: 'fallback replay'
    })
  })

  it('preserves explicit sequence accounting on daemon data events', () => {
    const current = createDaemonAdapter('daemon')
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })
    const dataSpy = vi.fn()
    provider.onData(dataSpy)

    current.emitData('daemon-session', '\x1b[6n', 0)

    expect(dataSpy).toHaveBeenCalledWith({
      id: 'daemon-session',
      data: '\x1b[6n',
      sequenceChars: 0
    })
  })

  it('detaches provider subscriptions without disposing the underlying providers', () => {
    const current = createDaemonAdapter('daemon')
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })
    const dataSpy = vi.fn()
    const exitSpy = vi.fn()
    provider.onData(dataSpy)
    provider.onExit(exitSpy)

    provider.disposeProviderOnly()
    current.emitData('daemon-session', 'data')
    fallback.emitExit('fallback-session', 0)

    expect(dataSpy).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()
    expect(current.dispose).not.toHaveBeenCalled()
  })

  it('shuts down fallback sessions before a daemon-provider swap', async () => {
    const current = createDaemonAdapter('daemon')
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })

    const fresh = await provider.spawn({ cols: 80, rows: 24 })
    const killedCount = await provider.shutdownFallbackSessions()

    expect(killedCount).toBe(1)
    expect(fallback.shutdown).toHaveBeenCalledWith(fresh.id, { immediate: true })
    expect(provider.hasPty(fresh.id)).toBe(false)
  })

  it('is best-effort: counts only successful shutdowns and never throws (keeps restart alive)', async () => {
    const current = createDaemonAdapter('daemon')
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })
    const stuck = await provider.spawn({ sessionId: 'stuck', cols: 80, rows: 24 })
    await provider.spawn({ sessionId: 'ok', cols: 80, rows: 24 })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(fallback.shutdown).mockImplementation(async (id: string) => {
      if (id === stuck.id) {
        throw new Error('still alive')
      }
    })

    // Why: a single un-killable local PTY must not abort the daemon restart.
    const killedCount = await provider.shutdownFallbackSessions()

    // Best-effort: the one that shut down is counted, the stuck one is not, and
    // crucially it does not throw — so the daemon restart sequence proceeds.
    expect(killedCount).toBe(1)
    expect(warn).toHaveBeenCalled()
    expect(fallback.shutdown).toHaveBeenCalledWith('stuck', { immediate: true })
    expect(fallback.shutdown).toHaveBeenCalledWith('ok', { immediate: true })
    warn.mockRestore()
  })

  it('fans synthetic exits for discovered current-daemon sessions only', async () => {
    const current = createDaemonAdapter('daemon', ['current-session'])
    const legacy = createDaemonAdapter('legacy', ['legacy-session'])
    const fallback = createProvider('fallback')
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [legacy], fallback })
    const exitSpy = vi.fn()
    provider.onExit(exitSpy)

    await provider.discoverDaemonSessions()
    provider.fanoutCurrentDaemonSyntheticExits(-1)

    expect(exitSpy).toHaveBeenCalledOnce()
    expect(exitSpy).toHaveBeenCalledWith({ id: 'current-session', code: -1 })
    expect(provider.getCurrentDaemonSessionIds()).toEqual([])
    expect(provider.hasPty('legacy-session')).toBe(true)
  })

  it('suppresses a synthetic daemon exit while a fallback duplicate survives', async () => {
    const current = createDaemonAdapter('daemon', ['duplicate-session'])
    const fallback = createProvider('fallback', ['duplicate-session'])
    const provider = new DegradedDaemonPtyProvider({ current, legacy: [], fallback })
    const exitSpy = vi.fn()
    provider.onExit(exitSpy)
    await provider.discoverDaemonSessions()

    provider.fanoutCurrentDaemonSyntheticExits(-1)

    expect(exitSpy).not.toHaveBeenCalled()
    expect(provider.hasPty('duplicate-session')).toBe(true)
    expect(provider.getCurrentDaemonSessionIds()).toEqual([])
  })
})
