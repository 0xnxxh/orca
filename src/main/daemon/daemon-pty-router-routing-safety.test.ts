import { describe, expect, it, vi } from 'vitest'
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
  it('fences unknown existing ids until a later complete legacy listing', async () => {
    const current = createAdapter('current')
    const legacy = createAdapter('legacy', ['legacy-session'])
    vi.mocked(legacy.adapter.listProcesses).mockRejectedValueOnce(new Error('listing failed'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
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
    await expect(router.spawn({ sessionId: 'legacy-session', cols: 80, rows: 24 })).rejects.toThrow(
      'daemon_session_routing_unavailable'
    )
    await expect(router.shutdown('legacy-session', { immediate: true })).rejects.toThrow(
      'daemon_session_routing_unavailable'
    )
    await expect(router.sendSignal('legacy-session', 'SIGTERM')).rejects.toThrow(
      'daemon_session_routing_unavailable'
    )

    await router.discoverLegacySessions()
    await router.spawn({ sessionId: 'legacy-session', cols: 80, rows: 24 })

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
    warn.mockRestore()
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
