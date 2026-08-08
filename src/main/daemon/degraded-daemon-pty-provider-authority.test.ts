import { describe, expect, it, vi } from 'vitest'
import { DegradedDaemonPtyProvider } from './degraded-daemon-pty-provider'
import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import type { IPtyProvider, PtyProcessInfo, PtySpawnOptions } from '../providers/types'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'

type ExactDataEvent = { id: string; data: string; incarnationId?: string }

type ProviderMock = IPtyProvider & {
  rows: PtyProcessInfo[]
  emitData: (payload: ExactDataEvent) => void
  emitIdentityChange: () => void
}

function authorityAccess(
  physicalPtyId: string,
  ptyIncarnationId: string
): TerminalSessionAuthorityPtyAccess {
  return {
    namespace: { authorityHostId: 'authority-host', namespaceId: 'namespace' },
    pane: { paneKey: physicalPtyId, paneGenerationId: 'renderer:1' },
    binding: {
      ownerIncarnationId: 'owner-incarnation',
      physicalPtyId,
      ptyIncarnationId
    }
  }
}

function listed(id: string, incarnationId: string, token: object): PtyProcessInfo {
  return {
    id,
    incarnationId,
    mutationRouteToken: token,
    terminalSessionAuthorityAccess: authorityAccess(id, incarnationId),
    cwd: '',
    title: 'shell'
  }
}

function createProvider(rows: PtyProcessInfo[]): ProviderMock {
  const dataListeners: ((payload: ExactDataEvent) => void)[] = []
  const identityListeners: (() => void)[] = []
  const provider = {
    rows,
    spawn: vi.fn(async (opts: PtySpawnOptions) => ({ id: opts.sessionId ?? 'spawned' })),
    attach: vi.fn(async () => {}),
    hasPty: vi.fn((id: string) => rows.some((row) => row.id === id)),
    probePtyLiveness: vi.fn(async (id: string) => rows.some((row) => row.id === id)),
    providesAgentSessionOwnerListings: vi.fn(() => true),
    write: vi.fn(),
    resize: vi.fn(),
    supportsExactPtyOperations: vi.fn(() => true),
    getPtyMutationMode: vi.fn(() => 'exact'),
    writeExact: vi.fn(() => true),
    resizeExact: vi.fn(() => true),
    killExact: vi.fn(async () => true),
    sendSignalExact: vi.fn(async () => true),
    clearBufferExact: vi.fn(async () => true),
    writeAuthorityExact: vi.fn(() => true),
    resizeAuthorityExact: vi.fn(() => true),
    killAuthorityExact: vi.fn(async () => true),
    sendSignalAuthorityExact: vi.fn(async () => true),
    clearBufferAuthorityExact: vi.fn(async () => true),
    bindTerminalSessionAuthorityAccess: vi.fn(() => true),
    shutdown: vi.fn(async () => {}),
    sendSignal: vi.fn(async () => {}),
    getCwd: vi.fn(async () => ''),
    getInitialCwd: vi.fn(async () => ''),
    clearBuffer: vi.fn(async () => {}),
    acknowledgeDataEvent: vi.fn(),
    hasChildProcesses: vi.fn(async () => false),
    getForegroundProcess: vi.fn(async () => null),
    serialize: vi.fn(async () => '{}'),
    revive: vi.fn(async () => {}),
    listProcesses: vi.fn(async () => rows),
    getPtyMutationRouteToken: vi.fn(
      (id: string) => rows.find((row) => row.id === id)?.mutationRouteToken ?? null
    ),
    getDefaultShell: vi.fn(async () => '/bin/sh'),
    getProfiles: vi.fn(async () => []),
    onData: vi.fn((callback: (payload: ExactDataEvent) => void) => {
      dataListeners.push(callback)
      return () => {}
    }),
    onReplay: vi.fn(() => () => {}),
    onExit: vi.fn(() => () => {}),
    onWriteUnavailable: vi.fn(() => () => {}),
    onDaemonIdentityChanged: vi.fn((callback: () => void) => {
      identityListeners.push(callback)
      return () => {}
    }),
    reconcileOnStartup: vi.fn(async () => ({ alive: [], killed: [] })),
    ackColdRestore: vi.fn(),
    clearTombstone: vi.fn(),
    disconnectOnly: vi.fn(async () => {}),
    dispose: vi.fn(),
    emitData: (payload: ExactDataEvent) => {
      for (const listener of dataListeners) {
        listener(payload)
      }
    },
    emitIdentityChange: () => {
      for (const listener of identityListeners) {
        listener()
      }
    }
  }
  return provider as unknown as ProviderMock
}

function asDaemon(provider: ProviderMock): DaemonPtyAdapter {
  return provider as unknown as DaemonPtyAdapter
}

describe('DegradedDaemonPtyProvider authority routing', () => {
  it('forwards authority operations to current and legacy daemon owners', async () => {
    const current = createProvider([listed('current-session', 'current-incarnation', {})])
    const legacy = createProvider([listed('legacy-session', 'legacy-incarnation', {})])
    const fallback = createProvider([])
    const provider = new DegradedDaemonPtyProvider({
      current: asDaemon(current),
      legacy: [asDaemon(legacy)],
      fallback
    })
    await provider.listProcesses()

    for (const [owner, id, incarnationId] of [
      [current, 'current-session', 'current-incarnation'],
      [legacy, 'legacy-session', 'legacy-incarnation']
    ] as const) {
      const access = authorityAccess(id, incarnationId)
      expect(provider.bindTerminalSessionAuthorityAccess(id, access)).toBe(true)
      expect(provider.writeAuthorityExact(id, access, 'input')).toBe(true)
      expect(provider.resizeAuthorityExact(id, access, 120, 40)).toBe(true)
      await expect(provider.sendSignalAuthorityExact(id, access, 'SIGTERM')).resolves.toBe(true)
      await expect(provider.clearBufferAuthorityExact(id, access)).resolves.toBe(true)
      await expect(provider.killAuthorityExact(id, access, { immediate: true })).resolves.toBe(true)
      expect(owner.writeAuthorityExact).toHaveBeenCalledWith(id, access, 'input')
      expect(owner.killAuthorityExact).toHaveBeenCalledWith(id, access, { immediate: true })
    }
  })

  it('fails closed for a fallback-versus-daemon collision', async () => {
    const access = authorityAccess('collision', 'incarnation')
    const current = createProvider([listed('collision', 'incarnation', {})])
    const fallback = createProvider([listed('collision', 'incarnation', {})])
    const provider = new DegradedDaemonPtyProvider({
      current: asDaemon(current),
      legacy: [],
      fallback
    })

    const inventory = await provider.listProcesses()

    expect(inventory.every((row) => row.mutationRouteToken === undefined)).toBe(true)
    expect(provider.getPtyMutationRouteToken('collision')).toBeNull()
    expect(provider.writeExact('collision', 'incarnation', 'blocked')).toBe(false)
    expect(provider.writeAuthorityExact('collision', access, 'blocked')).toBe(false)
    expect(provider.bindTerminalSessionAuthorityAccess('collision', access)).toBe(false)
    expect(current.writeAuthorityExact).not.toHaveBeenCalled()
    expect(fallback.writeAuthorityExact).not.toHaveBeenCalled()
  })

  it('moves route identity with inventory and invalidates it on daemon replacement', async () => {
    const oldToken = {}
    const newToken = {}
    const current = createProvider([])
    const legacy = createProvider([listed('moving', 'incarnation', oldToken)])
    const fallback = createProvider([])
    const provider = new DegradedDaemonPtyProvider({
      current: asDaemon(current),
      legacy: [asDaemon(legacy)],
      fallback
    })
    const [oldRow] = await provider.listProcesses()
    legacy.rows.splice(0)
    fallback.rows.push(listed('moving', 'incarnation', newToken))
    const [newRow] = await provider.listProcesses()

    expect(oldRow?.mutationRouteToken).toBe(oldToken)
    expect(newRow?.mutationRouteToken).toBe(newToken)
    expect(provider.getPtyMutationRouteToken('moving')).toBe(newToken)
    const access = authorityAccess('moving', 'incarnation')
    expect(provider.writeAuthorityExact('moving', access, 'fallback')).toBe(true)
    expect(fallback.writeAuthorityExact).toHaveBeenCalledWith('moving', access, 'fallback')

    fallback.rows.splice(0)
    current.rows.push(listed('moving', 'incarnation', {}))
    await provider.listProcesses()
    current.emitIdentityChange()
    expect(provider.getPtyMutationRouteToken('moving')).toBeNull()
    expect(provider.writeAuthorityExact('moving', access, 'blocked')).toBe(false)
  })

  it('rejects aggregate inventory when any provider list fails', async () => {
    const current = createProvider([])
    const fallback = createProvider([])
    vi.mocked(current.listProcesses).mockRejectedValue(new Error('daemon unavailable'))
    const provider = new DegradedDaemonPtyProvider({
      current: asDaemon(current),
      legacy: [],
      fallback
    })

    await expect(provider.listProcesses()).rejects.toThrow('daemon unavailable')
  })

  it('preserves the admitted incarnation through degraded data fanout', () => {
    const current = createProvider([])
    const fallback = createProvider([])
    const provider = new DegradedDaemonPtyProvider({
      current: asDaemon(current),
      legacy: [],
      fallback
    })
    const received: ExactDataEvent[] = []
    provider.onData((payload) => received.push(payload))

    current.emitData({ id: 'same-id', data: 'successor', incarnationId: 'incarnation-b' })

    expect(received).toEqual([{ id: 'same-id', data: 'successor', incarnationId: 'incarnation-b' }])
  })
})
