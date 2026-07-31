import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DaemonEndpointIdentity } from './daemon-hello-protocol'
import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import { DaemonPtyRouter } from './daemon-pty-router'
import type { PtyProcessInfo, PtySpawnOptions } from '../providers/types'

type AdapterHarness = {
  adapter: DaemonPtyAdapter
  emitIdentityChange: (previous: DaemonEndpointIdentity, current: DaemonEndpointIdentity) => void
  setIdentity: (identity: DaemonEndpointIdentity) => void
}

function identity(label: string, pid: number): DaemonEndpointIdentity {
  return {
    pid,
    startedAtMs: pid * 1_000,
    launchNonce: `${label}-${pid}`
  }
}

function createAdapter(
  label: string,
  sessions: string[] = [],
  reconcileResult: { alive: string[]; killed: string[] } = { alive: [], killed: [] }
): AdapterHarness {
  let daemonIdentity = identity(label, label === 'current' ? 20 : 10)
  const identityListeners: ((event: {
    previous: DaemonEndpointIdentity
    current: DaemonEndpointIdentity
  }) => void)[] = []
  const adapter = {
    protocolVersion: label === 'current' ? 30 : 29,
    getLastAuthenticatedDaemonIdentity: vi.fn(() => ({ ...daemonIdentity })),
    onDaemonIdentityChanged: vi.fn(
      (
        listener: (event: {
          previous: DaemonEndpointIdentity
          current: DaemonEndpointIdentity
        }) => void
      ) => {
        identityListeners.push(listener)
        return () => {}
      }
    ),
    listProcesses: vi.fn(
      async (): Promise<PtyProcessInfo[]> => sessions.map((id) => ({ id, cwd: '', title: label }))
    ),
    spawn: vi.fn(async (opts: PtySpawnOptions) => ({
      id: opts.sessionId ?? `${label}-fresh`
    })),
    probePtyLiveness: vi.fn(async (id: string) => sessions.includes(id)),
    hasPty: vi.fn((id: string) => sessions.includes(id)),
    shutdown: vi.fn(async () => {}),
    sendSignal: vi.fn(async () => {}),
    getBufferSnapshot: vi.fn(async () => null),
    ackColdRestore: vi.fn(),
    reconcileOnStartup: vi.fn(async () => reconcileResult),
    onData: vi.fn(() => () => {}),
    onExit: vi.fn(() => () => {}),
    onBackgroundStreamEvent: vi.fn(() => () => {}),
    onWriteUnavailable: vi.fn(() => () => {}),
    dispose: vi.fn(),
    disconnectOnly: vi.fn(async () => {})
  } as unknown as DaemonPtyAdapter

  return {
    adapter,
    setIdentity: (next) => {
      daemonIdentity = next
    },
    emitIdentityChange: (previous, current) => {
      for (const listener of identityListeners) {
        listener({ previous, current })
      }
    }
  }
}

describe('DaemonPtyRouter routing safety', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses conclusive probes while fencing absence after a failed discovery', async () => {
    const current = createAdapter('current')
    const legacy = createAdapter('legacy', ['legacy-session'])
    vi.mocked(legacy.adapter.listProcesses).mockRejectedValueOnce(new Error('listing failed'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const router = new DaemonPtyRouter({
      current: current.adapter,
      legacy: [legacy.adapter]
    })

    await router.discoverLegacySessions()
    await expect(
      router.spawn({
        sessionId: 'fresh-session',
        isNewSession: true,
        cols: 80,
        rows: 24
      })
    ).resolves.toMatchObject({ id: 'fresh-session' })
    await expect(
      router.spawn({ sessionId: 'legacy-session', cols: 80, rows: 24 })
    ).resolves.toMatchObject({ id: 'legacy-session' })
    await expect(router.shutdown('missing-session', { immediate: true })).rejects.toThrow(
      'daemon_session_routing_unavailable'
    )

    await router.discoverLegacySessions()
    await expect(router.shutdown('missing-session', { immediate: true })).rejects.toThrow(
      'terminal_gone'
    )

    expect(current.adapter.spawn).toHaveBeenCalledExactlyOnceWith({
      sessionId: 'fresh-session',
      isNewSession: true,
      cols: 80,
      rows: 24
    })
    expect(legacy.adapter.spawn).toHaveBeenCalledExactlyOnceWith({
      sessionId: 'legacy-session',
      cols: 80,
      rows: 24
    })
  })

  it('probes adapters outside an ambiguous route while discovery is incomplete', async () => {
    const sessionId = 'hidden-collision'
    const firstSessions = [sessionId]
    const current = createAdapter('current')
    const first = createAdapter('legacy-first', firstSessions)
    const second = createAdapter('legacy-second', [sessionId])
    const undiscovered = createAdapter('legacy-undiscovered', [sessionId])
    vi.mocked(undiscovered.adapter.listProcesses).mockRejectedValueOnce(
      new Error('listing unavailable')
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const router = new DaemonPtyRouter({
      current: current.adapter,
      legacy: [first.adapter, second.adapter, undiscovered.adapter]
    })

    await router.discoverLegacySessions()
    firstSessions.splice(0)

    await expect(router.sendSignal(sessionId, 'SIGTERM')).rejects.toThrow(
      'daemon_session_routing_unavailable'
    )
    expect(second.adapter.sendSignal).not.toHaveBeenCalled()
    expect(undiscovered.adapter.sendSignal).not.toHaveBeenCalled()
  })

  it('fails existing operations unknown when an owner probe is inconclusive', async () => {
    const current = createAdapter('current')
    const legacy = createAdapter('legacy')
    vi.mocked(legacy.adapter.probePtyLiveness).mockResolvedValue(null)
    const router = new DaemonPtyRouter({
      current: current.adapter,
      legacy: [legacy.adapter]
    })

    await expect(
      router.spawn({ sessionId: 'uncertain-session', cols: 80, rows: 24 })
    ).rejects.toThrow('daemon_session_routing_unavailable')
    await expect(router.shutdown('uncertain-session', { immediate: true })).rejects.toThrow(
      'daemon_session_routing_unavailable'
    )
    await expect(router.sendSignal('uncertain-session', 'SIGTERM')).rejects.toThrow(
      'daemon_session_routing_unavailable'
    )

    expect(current.adapter.spawn).not.toHaveBeenCalled()
    expect(current.adapter.shutdown).not.toHaveBeenCalled()
    expect(current.adapter.sendSignal).not.toHaveBeenCalled()
  })

  it('probes every adapter once and memoizes the unique owner', async () => {
    const current = createAdapter('current')
    const legacy = createAdapter('legacy', ['surviving-session'])
    const router = new DaemonPtyRouter({
      current: current.adapter,
      legacy: [legacy.adapter]
    })

    await router.sendSignal('surviving-session', 'SIGINT')
    await router.shutdown('surviving-session', { immediate: true })

    expect(current.adapter.probePtyLiveness).toHaveBeenCalledExactlyOnceWith('surviving-session')
    expect(legacy.adapter.probePtyLiveness).toHaveBeenCalledExactlyOnceWith('surviving-session')
    expect(legacy.adapter.sendSignal).toHaveBeenCalledWith('surviving-session', 'SIGINT')
    expect(legacy.adapter.shutdown).toHaveBeenCalledWith('surviving-session', {
      immediate: true
    })
  })

  it('keeps cross-generation id collisions ambiguous and away from current', async () => {
    const sessionId = 'colliding-session'
    const current = createAdapter('current', [sessionId], {
      alive: [sessionId],
      killed: []
    })
    const legacy = createAdapter('legacy', [sessionId], {
      alive: [sessionId],
      killed: []
    })
    const router = new DaemonPtyRouter({
      current: current.adapter,
      legacy: [legacy.adapter]
    })

    await router.reconcileOnStartup(new Set())
    expect(router.getSessionRouteState(sessionId)).toBe('ambiguous')
    await expect(router.spawn({ sessionId, cols: 80, rows: 24 })).rejects.toThrow(
      'daemon_session_routing_unavailable'
    )
    await expect(router.shutdown(sessionId, { immediate: true })).rejects.toThrow(
      'daemon_session_routing_unavailable'
    )

    expect(current.adapter.spawn).not.toHaveBeenCalled()
    expect(current.adapter.shutdown).not.toHaveBeenCalled()
  })

  it('collapses an ambiguous route after one daemon incarnation is replaced', async () => {
    const sessionId = 'replaced-collision'
    const current = createAdapter('current', [sessionId], {
      alive: [sessionId],
      killed: []
    })
    const legacy = createAdapter('legacy', [sessionId], {
      alive: [sessionId],
      killed: []
    })
    const router = new DaemonPtyRouter({
      current: current.adapter,
      legacy: [legacy.adapter]
    })
    const previous = identity('legacy', 10)
    const replacement = identity('legacy', 11)

    await router.reconcileOnStartup(new Set())
    legacy.setIdentity(replacement)
    legacy.emitIdentityChange(previous, replacement)

    expect(router.getSessionRouteState(sessionId)).toBe('owned')
    await router.sendSignal(sessionId, 'SIGTERM')
    expect(current.adapter.sendSignal).toHaveBeenCalledExactlyOnceWith(sessionId, 'SIGTERM')
    expect(legacy.adapter.sendSignal).not.toHaveBeenCalled()
  })

  it('keeps a canonical spawn collision ambiguous', async () => {
    const current = createAdapter('current')
    const legacy = createAdapter('legacy', ['canonical-session'])
    vi.mocked(current.adapter.spawn).mockResolvedValue({
      id: 'canonical-session',
      incarnationId: 'current-incarnation'
    })
    vi.mocked(current.adapter.probePtyLiveness).mockResolvedValue(true)
    const router = new DaemonPtyRouter({
      current: current.adapter,
      legacy: [legacy.adapter]
    })
    await router.discoverLegacySessions()

    await router.spawn({
      sessionId: 'requested-session',
      isNewSession: true,
      cols: 80,
      rows: 24,
      agentSessionEnsure: {} as never
    })

    expect(router.getSessionRouteState('canonical-session')).toBe('ambiguous')
    await expect(router.sendSignal('canonical-session', 'SIGTERM')).rejects.toThrow(
      'daemon_session_routing_unavailable'
    )
    expect(current.adapter.sendSignal).not.toHaveBeenCalled()
    expect(legacy.adapter.sendSignal).not.toHaveBeenCalled()
  })

  it('scopes unavailable tombstones to the authenticated daemon incarnation', async () => {
    const sessionId = 'legacy-session'
    const current = createAdapter('current')
    const legacy = createAdapter('legacy', [sessionId])
    const router = new DaemonPtyRouter({
      current: current.adapter,
      legacy: [legacy.adapter]
    })
    const previous = identity('legacy', 10)
    const replacement = identity('legacy', 11)

    await router.discoverLegacySessions()
    legacy.setIdentity(replacement)
    legacy.emitIdentityChange(previous, replacement)

    expect(router.getSessionRouteState(sessionId)).toBe('unavailable')
    await expect(router.sendSignal(sessionId, 'SIGTERM')).rejects.toThrow(
      'daemon_session_routing_unavailable'
    )
    expect(current.adapter.sendSignal).not.toHaveBeenCalled()

    await router.discoverLegacySessions()
    expect(router.getSessionRouteState(sessionId)).toBe('owned')
    await router.sendSignal(sessionId, 'SIGTERM')
    expect(legacy.adapter.sendSignal).toHaveBeenCalledWith(sessionId, 'SIGTERM')
  })

  it('allows explicit fresh reuse after the tombstone owner is replaced', async () => {
    const sessionId = 'legacy-session'
    const legacySessions = [sessionId]
    const current = createAdapter('current')
    const legacy = createAdapter('legacy', legacySessions)
    const router = new DaemonPtyRouter({
      current: current.adapter,
      legacy: [legacy.adapter]
    })
    const previous = identity('legacy', 10)
    const replacement = identity('legacy', 11)

    await router.discoverLegacySessions()
    legacy.setIdentity(replacement)
    legacy.emitIdentityChange(previous, replacement)
    legacySessions.splice(0)
    await router.discoverLegacySessions()

    await expect(
      router.spawn({ sessionId, isNewSession: true, cols: 80, rows: 24 })
    ).resolves.toMatchObject({ id: sessionId })
    expect(current.adapter.spawn).toHaveBeenCalledExactlyOnceWith({
      sessionId,
      isNewSession: true,
      cols: 80,
      rows: 24
    })
  })

  it('acknowledges a colliding id through the adapter that produced its snapshot', async () => {
    const sessionId = 'colliding-snapshot'
    const current = createAdapter('current', [sessionId], {
      alive: [sessionId],
      killed: []
    })
    const legacy = createAdapter('legacy', [sessionId])
    vi.mocked(legacy.adapter.getBufferSnapshot).mockResolvedValue({
      data: 'legacy frame',
      cols: 80,
      rows: 24,
      seq: 1,
      source: 'headless'
    })
    const router = new DaemonPtyRouter({
      current: current.adapter,
      legacy: [legacy.adapter]
    })

    await router.discoverLegacySessions()
    await router.getBufferSnapshot(sessionId)
    await router.reconcileOnStartup(new Set())
    router.ackColdRestore(sessionId)

    expect(legacy.adapter.ackColdRestore).toHaveBeenCalledExactlyOnceWith(sessionId)
    expect(current.adapter.ackColdRestore).not.toHaveBeenCalled()
  })

  it('clears a stale snapshot producer after a later null capture', async () => {
    const sessionId = 'legacy-snapshot'
    const current = createAdapter('current')
    const legacy = createAdapter('legacy', [sessionId])
    vi.mocked(legacy.adapter.getBufferSnapshot)
      .mockResolvedValueOnce({
        data: 'legacy frame',
        cols: 80,
        rows: 24,
        seq: 1,
        source: 'headless'
      })
      .mockResolvedValueOnce(null)
    const router = new DaemonPtyRouter({
      current: current.adapter,
      legacy: [legacy.adapter]
    })

    await router.discoverLegacySessions()
    await router.getBufferSnapshot(sessionId)
    await router.getBufferSnapshot(sessionId)
    router.ackColdRestore(sessionId)

    expect(legacy.adapter.ackColdRestore).not.toHaveBeenCalled()
  })

  it('passes folder and git-worktree keys through the same reconciliation path', async () => {
    const current = createAdapter('current')
    const legacy = createAdapter('legacy')
    const router = new DaemonPtyRouter({
      current: current.adapter,
      legacy: [legacy.adapter]
    })
    const validWorkspaceKeys = new Set(['folder:folder-1', 'repo-1::/workspace/project'])

    await router.reconcileOnStartup(validWorkspaceKeys)

    expect(current.adapter.reconcileOnStartup).toHaveBeenCalledExactlyOnceWith(validWorkspaceKeys)
    expect(legacy.adapter.reconcileOnStartup).toHaveBeenCalledExactlyOnceWith(validWorkspaceKeys)
  })
})
