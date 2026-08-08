import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DaemonSessionInfo } from '../daemon/types'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'

const {
  handleMock,
  removeHandlerMock,
  getDaemonProviderMock,
  restartDaemonMock,
  getCurrentDaemonMacTccAttributionHealthMock
} = vi.hoisted(() => ({
  handleMock: vi.fn(),
  removeHandlerMock: vi.fn(),
  getDaemonProviderMock: vi.fn(),
  restartDaemonMock: vi.fn(),
  getCurrentDaemonMacTccAttributionHealthMock: vi.fn(async () => 'unknown')
}))

vi.mock('electron', () => ({
  ipcMain: { handle: handleMock, removeHandler: removeHandlerMock }
}))

vi.mock('../daemon/daemon-init', () => ({
  getDaemonProvider: getDaemonProviderMock,
  restartDaemon: restartDaemonMock,
  getCurrentDaemonMacTccAttributionHealth: getCurrentDaemonMacTccAttributionHealthMock
}))

// Why: the handler uses `provider instanceof DaemonPtyRouter` to branch
// between "plain adapter" and "router with current + legacy adapters".
// Mock the class here so tests can construct real instances via `new
// DaemonPtyRouter(...)` and the instanceof check returns true. The real
// router's constructor is side-effect heavy (subscribes to adapter events),
// so we only keep the accessors that pty-management touches — enough to
// satisfy the runtime type check without pulling in all the wiring.
vi.mock('../daemon/daemon-pty-router', () => {
  class DaemonPtyRouter {
    private allAdapters: unknown[]
    constructor(opts: { current: unknown; legacy: unknown[] }) {
      this.allAdapters = [opts.current, ...opts.legacy]
    }
    getAllAdapters() {
      return this.allAdapters
    }
  }
  return { DaemonPtyRouter }
})

// Why: the handler also branches on `provider instanceof DegradedDaemonPtyProvider`
// (for getAllAdapters) and reports `degraded` from it. The real constructor
// subscribes to adapter events, so keep only the accessors pty-management uses.
vi.mock('../daemon/degraded-daemon-pty-provider', () => {
  class DegradedDaemonPtyProvider {
    private allAdapters: unknown[]
    private routesFreshToFallback = true
    constructor(opts: { current: unknown; legacy: unknown[] }) {
      this.allAdapters = [opts.current, ...opts.legacy]
    }
    get routesFreshSpawnsToLocalProvider(): true | undefined {
      return this.routesFreshToFallback ? true : undefined
    }
    async recoverFreshSpawnRouting(): Promise<boolean> {
      this.routesFreshToFallback = false
      return true
    }
    getAllAdapters() {
      return this.allAdapters
    }
  }
  return { DegradedDaemonPtyProvider }
})

type HandlerMap = Record<string, (event: unknown, args?: unknown) => unknown>

function buildHandlerMap(): HandlerMap {
  const map: HandlerMap = {}
  for (const call of handleMock.mock.calls) {
    const [channel, handler] = call as [string, (event: unknown, args?: unknown) => unknown]
    map[channel] = handler
  }
  return map
}

function makeSession(
  sessionId: string,
  overrides: Partial<DaemonSessionInfo> = {}
): DaemonSessionInfo {
  return {
    sessionId,
    incarnationId: `${sessionId}-incarnation`,
    state: 'running',
    shellState: 'ready',
    isAlive: true,
    pid: 1234,
    cwd: '/home/user',
    cols: 80,
    rows: 24,
    createdAt: 0,
    protocolVersion: 5,
    ...overrides
  }
}

type MockAdapter = {
  protocolVersion: number
  listSessions: ReturnType<typeof vi.fn>
  shutdown: ReturnType<typeof vi.fn>
  killExact: ReturnType<typeof vi.fn>
  killAuthorityExact: ReturnType<typeof vi.fn>
  getPtyMutationRouteToken: ReturnType<typeof vi.fn>
  mutationRouteToken: object | null
}

function daemonSessionRows(sessions: DaemonSessionInfo[], mutationRouteToken: object | null) {
  return sessions.map(({ protocolVersion: _pv, ...rest }) => ({
    ...rest,
    ...(mutationRouteToken ? { mutationRouteToken } : {})
  }))
}

function makeAdapter(
  protocolVersion: number,
  sessions: DaemonSessionInfo[],
  shutdownImpl?: (id: string, opts: { immediate?: boolean }) => Promise<void>
): MockAdapter {
  // Why: collectSessions calls adapter.listSessions() (the daemon-side RPC)
  // and then annotates with adapter.protocolVersion. The mock returns the
  // *internal* SessionInfo shape (no protocolVersion) since the adapter adds
  // it. Stripping it here mirrors production behavior.
  const mutationRouteToken = Object.freeze({})
  const shutdown = vi.fn(shutdownImpl ?? (async () => {}))
  const adapter: MockAdapter = {
    protocolVersion,
    listSessions: vi.fn(async () => daemonSessionRows(sessions, adapter.mutationRouteToken)),
    shutdown,
    killExact: vi.fn(),
    killAuthorityExact: vi.fn(),
    getPtyMutationRouteToken: vi.fn(() => adapter.mutationRouteToken),
    mutationRouteToken
  }
  adapter.killExact.mockImplementation(
    async (id: string, _incarnationId: string, opts: { immediate?: boolean }) => {
      await shutdown(id, opts)
      return true
    }
  )
  adapter.killAuthorityExact.mockImplementation(
    async (id: string, _access: unknown, opts: { immediate?: boolean }) => {
      await shutdown(id, opts)
      return true
    }
  )
  return adapter
}

async function importFresh() {
  vi.resetModules()
  handleMock.mockClear()
  removeHandlerMock.mockClear()
  return import('./pty-management')
}

async function makeRouter(current: MockAdapter, legacy: MockAdapter[] = []) {
  const { DaemonPtyRouter } = await import('../daemon/daemon-pty-router')
  return new DaemonPtyRouter({ current: current as never, legacy: legacy as never })
}

async function makeDegradedProvider(current: MockAdapter, legacy: MockAdapter[] = []) {
  const { DegradedDaemonPtyProvider } = await import('../daemon/degraded-daemon-pty-provider')
  return new DegradedDaemonPtyProvider({
    current: current as never,
    legacy: legacy as never,
    fallback: undefined as never
  })
}

describe('pty:management IPC handlers', () => {
  beforeEach(() => {
    getDaemonProviderMock.mockReset()
    restartDaemonMock.mockReset()
    getCurrentDaemonMacTccAttributionHealthMock.mockReset()
    getCurrentDaemonMacTccAttributionHealthMock.mockResolvedValue('unknown')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('listSessions', () => {
    it('merges sessions across current + legacy adapters with protocolVersion', async () => {
      const current = makeAdapter(5, [makeSession('new-1'), makeSession('new-2')])
      const legacy = makeAdapter(3, [makeSession('old-1', { protocolVersion: 3 })])
      const { registerDaemonManagementHandlers } = await importFresh()
      getDaemonProviderMock.mockReturnValue(await makeRouter(current, [legacy]))
      registerDaemonManagementHandlers()

      const handlers = buildHandlerMap()
      const result = (await handlers['pty:management:listSessions']({})) as {
        sessions: DaemonSessionInfo[]
        degraded: boolean
      }

      expect(result.sessions).toHaveLength(3)
      expect(result.degraded).toBe(false)
      const byId = new Map(result.sessions.map((s) => [s.sessionId, s]))
      expect(byId.get('new-1')?.protocolVersion).toBe(5)
      expect(byId.get('new-2')?.protocolVersion).toBe(5)
      expect(byId.get('old-1')?.protocolVersion).toBe(3)
    })

    it('reports degraded mode and still lists sessions when the daemon cannot spawn fresh PTYs', async () => {
      const current = makeAdapter(5, [makeSession('preserved-1')])
      const { registerDaemonManagementHandlers } = await importFresh()
      getDaemonProviderMock.mockReturnValue(await makeDegradedProvider(current))
      registerDaemonManagementHandlers()

      const handlers = buildHandlerMap()
      const result = (await handlers['pty:management:listSessions']({})) as {
        sessions: DaemonSessionInfo[]
        degraded: boolean
      }

      expect(result.degraded).toBe(true)
      expect(result.sessions.map((s) => s.sessionId)).toEqual(['preserved-1'])
    })

    it('clears degraded mode after durable fresh-spawn routing recovers', async () => {
      const current = makeAdapter(5, [makeSession('preserved-1')])
      const provider = await makeDegradedProvider(current)
      const { registerDaemonManagementHandlers } = await importFresh()
      getDaemonProviderMock.mockReturnValue(provider)
      registerDaemonManagementHandlers()
      const handler = buildHandlerMap()['pty:management:listSessions']

      await expect(handler({})).resolves.toMatchObject({ degraded: true })
      await provider.recoverFreshSpawnRouting()
      await expect(handler({})).resolves.toMatchObject({ degraded: false })
    })

    it('returns empty list when no daemon provider is installed', async () => {
      getDaemonProviderMock.mockReturnValue(null)

      const { registerDaemonManagementHandlers } = await importFresh()
      registerDaemonManagementHandlers()

      const handlers = buildHandlerMap()
      const result = (await handlers['pty:management:listSessions']({})) as {
        sessions: DaemonSessionInfo[]
      }

      expect(result.sessions).toEqual([])
    })

    it('tolerates a failing adapter by skipping its sessions', async () => {
      const current = makeAdapter(5, [makeSession('new-1')])
      const legacy = makeAdapter(3, [])
      legacy.listSessions = vi.fn(async () => {
        throw new Error('legacy socket dead')
      })
      const { registerDaemonManagementHandlers } = await importFresh()
      getDaemonProviderMock.mockReturnValue(await makeRouter(current, [legacy]))
      registerDaemonManagementHandlers()

      const handlers = buildHandlerMap()
      const result = (await handlers['pty:management:listSessions']({})) as {
        sessions: DaemonSessionInfo[]
      }

      expect(result.sessions).toHaveLength(1)
      expect(result.sessions[0].sessionId).toBe('new-1')
    })
  })

  describe('killAll', () => {
    // Why: the handler sleeps POLL_INTERVAL_MS between listSessions polls.
    // Fake timers let the tests drive that loop deterministically — without
    // them, a happy-path test that converges in ≥1 poll would take 100ms+
    // of real wall time and the "refuses to die" test would take ~1s.
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    async function runKillAllWithPolls(
      handler: (event: unknown, args?: unknown) => unknown,
      pollCount: number = 65
    ): Promise<{ killedCount: number; remainingCount: number; killedSessionIds: string[] }> {
      const resultPromise = handler({}) as Promise<{
        killedCount: number
        remainingCount: number
        killedSessionIds: string[]
      }>
      // Why: advance the loop's sleeps one at a time. Between each sleep the
      // handler awaits collectSessions (a microtask), so we need to flush
      // pending microtasks before advancing the next timer.
      for (let i = 0; i < pollCount; i += 1) {
        await Promise.resolve()
        await Promise.resolve()
        await vi.advanceTimersByTimeAsync(100)
      }
      return resultPromise
    }

    it('fires one shutdown per initial session and polls until empty', async () => {
      const currentSessions = [makeSession('new-1'), makeSession('new-2')]
      const legacySessions = [makeSession('old-1', { protocolVersion: 3 })]
      const current = makeAdapter(5, [])
      const legacy = makeAdapter(3, [])
      // Why: shutdown removes the session from the adapter's backing list so
      // the next poll observes the shrinking set — mirrors a daemon that
      // actually reaped the processes.
      const removeFrom = (list: DaemonSessionInfo[], id: string): void => {
        const idx = list.findIndex((s) => s.sessionId === id)
        if (idx !== -1) {
          list.splice(idx, 1)
        }
      }
      current.listSessions = vi.fn(async () =>
        daemonSessionRows(currentSessions, current.mutationRouteToken)
      )
      legacy.listSessions = vi.fn(async () =>
        daemonSessionRows(legacySessions, legacy.mutationRouteToken)
      )
      current.shutdown.mockImplementation(async (id: string) => {
        removeFrom(currentSessions, id)
      })
      legacy.shutdown.mockImplementation(async (id: string) => {
        removeFrom(legacySessions, id)
      })
      const { registerDaemonManagementHandlers } = await importFresh()
      getDaemonProviderMock.mockReturnValue(await makeRouter(current, [legacy]))
      registerDaemonManagementHandlers()

      const handlers = buildHandlerMap()
      const result = await runKillAllWithPolls(handlers['pty:management:killAll'])

      expect(result).toEqual({
        killedCount: 3,
        remainingCount: 0,
        killedSessionIds: ['new-1', 'new-2', 'old-1']
      })
      // Each initial session receives exactly one shutdown — no retries.
      expect(current.shutdown).toHaveBeenCalledTimes(2)
      expect(current.shutdown).toHaveBeenCalledWith('new-1', { immediate: true })
      expect(current.shutdown).toHaveBeenCalledWith('new-2', { immediate: true })
      expect(legacy.shutdown).toHaveBeenCalledTimes(1)
      expect(legacy.shutdown).toHaveBeenCalledWith('old-1', { immediate: true })
    })

    it('reports remainingCount when sessions refuse to die after the poll window', async () => {
      const sessions = [makeSession('stuck')]
      const current = makeAdapter(5, [])
      current.listSessions = vi.fn(async () =>
        daemonSessionRows(sessions, current.mutationRouteToken)
      )
      // Why: shutdown resolves but the session never leaves listSessions —
      // simulates a process wedged in uninterruptible sleep. After the poll
      // window (≈6.5s, past the daemon's 5s SIGTERM→SIGKILL ladder) the
      // handler must return remainingCount=1 rather than loop forever.
      current.shutdown.mockImplementation(async () => {})
      const { registerDaemonManagementHandlers } = await importFresh()
      getDaemonProviderMock.mockReturnValue(await makeRouter(current))
      registerDaemonManagementHandlers()

      const handlers = buildHandlerMap()
      const result = await runKillAllWithPolls(handlers['pty:management:killAll'])

      expect(result).toEqual({ killedCount: 0, remainingCount: 1, killedSessionIds: [] })
      // One shutdown fired — no per-session retry. Initial-snapshot
      // accounting means the stuck session is counted once.
      expect(current.shutdown).toHaveBeenCalledTimes(1)
    })

    it('does not count respawned sessions with fresh IDs against remainingCount', async () => {
      // Why: mounted panes may re-call pty:spawn with brand-new session IDs
      // while killAll is polling (tab remount, navigate-back). Those fresh
      // IDs are not part of the initial snapshot and must not inflate the
      // "refused to exit" count — the user asked to kill what was alive
      // when the button was pressed, not to chase new spawns.
      const liveSessions = [makeSession('a'), makeSession('b')]
      const current = makeAdapter(5, [])
      let pollCalls = 0
      current.listSessions = vi.fn(async () => {
        pollCalls += 1
        if (pollCalls === 1) {
          // Initial snapshot: a and b are alive.
          return daemonSessionRows(liveSessions, current.mutationRouteToken)
        }
        // First poll onward: a and b have been reaped, but the renderer
        // respawned a fresh pane with id 'c'. 'c' was never in the initial
        // snapshot, so it must not count as remaining.
        return daemonSessionRows([makeSession('c')], current.mutationRouteToken)
      })
      current.shutdown.mockImplementation(async () => {})
      const { registerDaemonManagementHandlers } = await importFresh()
      getDaemonProviderMock.mockReturnValue(await makeRouter(current))
      registerDaemonManagementHandlers()

      const handlers = buildHandlerMap()
      const result = await runKillAllWithPolls(handlers['pty:management:killAll'])

      expect(result).toEqual({
        killedCount: 2,
        remainingCount: 0,
        killedSessionIds: ['a', 'b']
      })
    })

    it('does not chase a same-ID successor with a new incarnation', async () => {
      const sessions = [
        makeSession('reused', { protocolVersion: 33, incarnationId: 'incarnation-old' })
      ]
      const current = makeAdapter(33, [])
      current.listSessions = vi.fn(async () =>
        daemonSessionRows(sessions, current.mutationRouteToken)
      )
      current.killExact = vi.fn(async (_id: string, incarnationId: string) => {
        if (incarnationId !== 'incarnation-old') {
          return false
        }
        sessions.splice(
          0,
          1,
          makeSession('reused', {
            protocolVersion: 33,
            incarnationId: 'incarnation-new'
          })
        )
        return true
      })
      const { registerDaemonManagementHandlers } = await importFresh()
      getDaemonProviderMock.mockReturnValue(await makeRouter(current))
      registerDaemonManagementHandlers()

      const result = await runKillAllWithPolls(buildHandlerMap()['pty:management:killAll'])

      expect(result).toEqual({
        killedCount: 1,
        remainingCount: 0,
        killedSessionIds: ['reused']
      })
      expect(current.killExact).toHaveBeenCalledOnce()
      expect(current.killExact).toHaveBeenCalledWith('reused', 'incarnation-old', {
        immediate: true
      })
    })

    it('swallows per-session shutdown rejections without stopping the batch', async () => {
      const sessionsList = [makeSession('a'), makeSession('b')]
      const current = makeAdapter(5, [])
      current.listSessions = vi.fn(async () =>
        daemonSessionRows(sessionsList, current.mutationRouteToken)
      )
      // Why: a rejecting shutdown for 'a' must not block the shutdown of 'b'.
      // Since shutdowns fire in parallel (Promise.allSettled), both must be
      // invoked regardless of 'a' throwing.
      const removeFrom = (id: string): void => {
        const idx = sessionsList.findIndex((s) => s.sessionId === id)
        if (idx !== -1) {
          sessionsList.splice(idx, 1)
        }
      }
      current.shutdown.mockImplementation(async (id: string) => {
        if (id === 'a') {
          throw new Error('a is stuck')
        }
        removeFrom(id)
      })
      const { registerDaemonManagementHandlers } = await importFresh()
      getDaemonProviderMock.mockReturnValue(await makeRouter(current))
      registerDaemonManagementHandlers()

      const handlers = buildHandlerMap()
      const result = await runKillAllWithPolls(handlers['pty:management:killAll'])

      expect(current.shutdown).toHaveBeenCalledWith('a', { immediate: true })
      expect(current.shutdown).toHaveBeenCalledWith('b', { immediate: true })
      // 'a' rejected and is still alive → counts as remaining; 'b' reaped.
      expect(result).toEqual({
        killedCount: 1,
        remainingCount: 1,
        killedSessionIds: ['b']
      })
    })

    it('does not mutate or report success when an adapter inventory rejects', async () => {
      const current = makeAdapter(5, [makeSession('visible')])
      const legacy = makeAdapter(3, [makeSession('unknown', { protocolVersion: 3 })])
      legacy.listSessions.mockRejectedValue(new Error('legacy daemon unavailable'))
      const { registerDaemonManagementHandlers } = await importFresh()
      getDaemonProviderMock.mockReturnValue(await makeRouter(current, [legacy]))
      registerDaemonManagementHandlers()

      await expect(buildHandlerMap()['pty:management:killAll']({})).rejects.toThrow(
        'pty_management_inventory_unavailable:3'
      )
      expect(current.killExact).not.toHaveBeenCalled()
      expect(legacy.killExact).not.toHaveBeenCalled()
      expect(current.shutdown).not.toHaveBeenCalled()
      expect(legacy.shutdown).not.toHaveBeenCalled()
    })

    it('does not turn a poll-time adapter failure into killed sessions', async () => {
      const currentSessions = [makeSession('pending')]
      const current = makeAdapter(5, [])
      current.listSessions
        .mockImplementationOnce(async () =>
          daemonSessionRows(currentSessions, current.mutationRouteToken)
        )
        .mockRejectedValueOnce(new Error('daemon disconnected before exit outcome'))
      current.killExact.mockResolvedValue(true)
      const { registerDaemonManagementHandlers } = await importFresh()
      getDaemonProviderMock.mockReturnValue(await makeRouter(current))
      registerDaemonManagementHandlers()

      const result = buildHandlerMap()['pty:management:killAll']({}) as Promise<unknown>
      const rejected = expect(result).rejects.toThrow('pty_management_inventory_unavailable:5')
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(100)
      await rejected
      expect(current.killExact).toHaveBeenCalledOnce()
    })
  })

  describe('killOne', () => {
    it('routes to the adapter whose protocolVersion owns the session', async () => {
      const current = makeAdapter(5, [makeSession('new-1')])
      const legacy = makeAdapter(3, [makeSession('old-1', { protocolVersion: 3 })])
      const { registerDaemonManagementHandlers } = await importFresh()
      getDaemonProviderMock.mockReturnValue(await makeRouter(current, [legacy]))
      registerDaemonManagementHandlers()

      const handlers = buildHandlerMap()
      const result = (await handlers['pty:management:killOne']({}, { sessionId: 'old-1' })) as {
        success: boolean
      }

      expect(result.success).toBe(true)
      expect(legacy.shutdown).toHaveBeenCalledWith('old-1', { immediate: true })
      expect(current.shutdown).not.toHaveBeenCalled()
    })

    it('rejects a same-ID successor that replaces the listed incarnation before kill', async () => {
      const current = makeAdapter(33, [])
      let currentIncarnation = 'incarnation-old'
      current.listSessions = vi.fn(async () => {
        const listedIncarnation = currentIncarnation
        currentIncarnation = 'incarnation-new'
        return daemonSessionRows(
          [
            makeSession('reused', {
              protocolVersion: 33,
              incarnationId: listedIncarnation
            })
          ],
          current.mutationRouteToken
        )
      })
      current.killExact = vi.fn(
        async (_id: string, incarnationId: string) => incarnationId === currentIncarnation
      )
      const { registerDaemonManagementHandlers } = await importFresh()
      getDaemonProviderMock.mockReturnValue(await makeRouter(current))
      registerDaemonManagementHandlers()

      const result = (await buildHandlerMap()['pty:management:killOne'](
        {},
        { sessionId: 'reused' }
      )) as { success: boolean }

      expect(result.success).toBe(false)
      expect(current.killExact).toHaveBeenCalledWith('reused', 'incarnation-old', {
        immediate: true
      })
      expect(current.shutdown).not.toHaveBeenCalled()
    })

    it('rejects a session after its adapter route is replaced', async () => {
      const current = makeAdapter(33, [])
      current.listSessions = vi.fn(async () => {
        const listedRouteToken = current.mutationRouteToken
        current.mutationRouteToken = Object.freeze({})
        return daemonSessionRows(
          [makeSession('reused', { protocolVersion: 33, incarnationId: 'incarnation-old' })],
          listedRouteToken
        )
      })
      const { registerDaemonManagementHandlers } = await importFresh()
      getDaemonProviderMock.mockReturnValue(await makeRouter(current))
      registerDaemonManagementHandlers()

      const result = (await buildHandlerMap()['pty:management:killOne'](
        {},
        { sessionId: 'reused' }
      )) as { success: boolean }

      expect(result.success).toBe(false)
      expect(current.killExact).not.toHaveBeenCalled()
      expect(current.shutdown).not.toHaveBeenCalled()
    })

    it('rejects killOne when another adapter inventory is unknown', async () => {
      const current = makeAdapter(5, [makeSession('visible')])
      const legacy = makeAdapter(3, [])
      legacy.listSessions.mockRejectedValue(new Error('legacy daemon unavailable'))
      const { registerDaemonManagementHandlers } = await importFresh()
      getDaemonProviderMock.mockReturnValue(await makeRouter(current, [legacy]))
      registerDaemonManagementHandlers()

      const result = (await buildHandlerMap()['pty:management:killOne'](
        {},
        { sessionId: 'visible' }
      )) as { success: boolean }

      expect(result.success).toBe(false)
      expect(current.killExact).not.toHaveBeenCalled()
      expect(current.shutdown).not.toHaveBeenCalled()
    })

    it('uses full authority access and never falls back to incarnation-only kill', async () => {
      const authorityAccess: TerminalSessionAuthorityPtyAccess = {
        namespace: { authorityHostId: 'host-1', namespaceId: 'namespace-1' },
        pane: { paneKey: 'pane-1', paneGenerationId: 'renderer:1' },
        binding: {
          ownerIncarnationId: 'owner-1',
          physicalPtyId: 'authority-1',
          ptyIncarnationId: 'authority-incarnation'
        }
      }
      const session = {
        ...makeSession('authority-1', {
          protocolVersion: 34,
          incarnationId: 'authority-incarnation'
        }),
        terminalSessionAuthorityAccess: authorityAccess
      }
      const current = makeAdapter(34, [session])
      const { registerDaemonManagementHandlers } = await importFresh()
      getDaemonProviderMock.mockReturnValue(await makeRouter(current))
      registerDaemonManagementHandlers()

      const result = (await buildHandlerMap()['pty:management:killOne'](
        {},
        { sessionId: 'authority-1' }
      )) as { success: boolean }

      expect(result.success).toBe(true)
      expect(current.killAuthorityExact).toHaveBeenCalledWith('authority-1', authorityAccess, {
        immediate: true
      })
      expect(current.killExact).not.toHaveBeenCalled()
    })

    it('treats identity-free inventory as non-destructive', async () => {
      const current = makeAdapter(32, [makeSession('legacy-1', { incarnationId: undefined })])
      const { registerDaemonManagementHandlers } = await importFresh()
      getDaemonProviderMock.mockReturnValue(await makeRouter(current))
      registerDaemonManagementHandlers()

      const result = (await buildHandlerMap()['pty:management:killOne'](
        {},
        { sessionId: 'legacy-1' }
      )) as { success: boolean }

      expect(result.success).toBe(false)
      expect(current.killExact).not.toHaveBeenCalled()
      expect(current.killAuthorityExact).not.toHaveBeenCalled()
      expect(current.shutdown).not.toHaveBeenCalled()
    })

    it('returns success=false for unknown sessionId', async () => {
      const current = makeAdapter(5, [makeSession('new-1')])
      const { registerDaemonManagementHandlers } = await importFresh()
      getDaemonProviderMock.mockReturnValue(await makeRouter(current))
      registerDaemonManagementHandlers()

      const handlers = buildHandlerMap()
      const result = (await handlers['pty:management:killOne']({}, { sessionId: 'ghost' })) as {
        success: boolean
      }

      expect(result.success).toBe(false)
      expect(current.shutdown).not.toHaveBeenCalled()
    })

    it('rejects empty/missing sessionId without hitting the adapter', async () => {
      const current = makeAdapter(5, [makeSession('new-1')])
      const { registerDaemonManagementHandlers } = await importFresh()
      getDaemonProviderMock.mockReturnValue(await makeRouter(current))
      registerDaemonManagementHandlers()

      const handlers = buildHandlerMap()
      const result = (await handlers['pty:management:killOne']({}, { sessionId: '' })) as {
        success: boolean
      }

      expect(result.success).toBe(false)
      expect(current.listSessions).not.toHaveBeenCalled()
    })
  })

  describe('macTccAttribution', () => {
    it('reports the daemon attribution health', async () => {
      getCurrentDaemonMacTccAttributionHealthMock.mockResolvedValue('severed')

      const { registerDaemonManagementHandlers } = await importFresh()
      registerDaemonManagementHandlers()

      const handlers = buildHandlerMap()
      const result = (await handlers['pty:management:macTccAttribution']({})) as {
        health: string
      }

      expect(result.health).toBe('severed')
    })

    it('fails open to unknown when the probe throws', async () => {
      getCurrentDaemonMacTccAttributionHealthMock.mockRejectedValue(new Error('no pid record'))

      const { registerDaemonManagementHandlers } = await importFresh()
      registerDaemonManagementHandlers()

      const handlers = buildHandlerMap()
      const result = (await handlers['pty:management:macTccAttribution']({})) as {
        health: string
      }

      expect(result.health).toBe('unknown')
    })
  })

  describe('restart', () => {
    it('delegates to restartDaemon and reports success', async () => {
      restartDaemonMock.mockResolvedValue({ killedCount: 2 })

      const { registerDaemonManagementHandlers } = await importFresh()
      registerDaemonManagementHandlers()

      const handlers = buildHandlerMap()
      const result = (await handlers['pty:management:restart']({})) as { success: boolean }

      expect(result.success).toBe(true)
      expect(restartDaemonMock).toHaveBeenCalledTimes(1)
    })

    it('returns success=false when restartDaemon throws', async () => {
      restartDaemonMock.mockRejectedValue(new Error('spawn failed'))

      const { registerDaemonManagementHandlers } = await importFresh()
      registerDaemonManagementHandlers()

      const handlers = buildHandlerMap()
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const result = (await handlers['pty:management:restart']({})) as { success: boolean }
      consoleErrorSpy.mockRestore()

      expect(result.success).toBe(false)
    })
  })
})
