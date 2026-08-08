import { describe, expect, it, vi } from 'vitest'
import { DaemonPtyRouter } from './daemon-pty-router'
import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import type { PtyProcessInfo } from '../providers/types'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'
import { sweepProviderPtysForWorktree } from '../runtime/worktree-pty-inventory-sweep'

type ExactDataEvent = {
  id: string
  data: string
  incarnationId?: string
}

type AuthorityAdapterMock = DaemonPtyAdapter & {
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

function listed(
  id: string,
  incarnationId: string,
  token: object,
  worktreeId?: string
): PtyProcessInfo {
  return {
    id,
    incarnationId,
    mutationRouteToken: token,
    terminalSessionAuthorityAccess: authorityAccess(id, incarnationId),
    cwd: '',
    title: 'shell',
    ...(worktreeId ? { worktreeId } : {})
  }
}

function createAdapter(rows: PtyProcessInfo[]): AuthorityAdapterMock {
  const dataListeners: ((payload: ExactDataEvent) => void)[] = []
  const identityListeners: (() => void)[] = []
  const adapter = {
    rows,
    protocolVersion: 34,
    listProcesses: vi.fn(async () => rows),
    getPtyMutationRouteToken: vi.fn(
      (id: string) => rows.find((row) => row.id === id)?.mutationRouteToken ?? null
    ),
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
    hasPty: vi.fn((id: string) => rows.some((row) => row.id === id)),
    onData: vi.fn((callback: (payload: ExactDataEvent) => void) => {
      dataListeners.push(callback)
      return () => {}
    }),
    onExit: vi.fn(() => () => {}),
    onReplay: vi.fn(() => () => {}),
    onBackgroundStreamEvent: vi.fn(() => () => {}),
    onWriteUnavailable: vi.fn(() => () => {}),
    onDaemonIdentityChanged: vi.fn((callback: () => void) => {
      identityListeners.push(callback)
      return () => {}
    }),
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
  return adapter as unknown as AuthorityAdapterMock
}

async function expectAuthorityOperations(
  router: DaemonPtyRouter,
  adapter: AuthorityAdapterMock,
  id: string,
  incarnationId: string
): Promise<void> {
  const access = authorityAccess(id, incarnationId)
  expect(router.bindTerminalSessionAuthorityAccess(id, access)).toBe(true)
  expect(router.writeAuthorityExact(id, access, 'input')).toBe(true)
  expect(router.resizeAuthorityExact(id, access, 120, 40)).toBe(true)
  await expect(router.sendSignalAuthorityExact(id, access, 'SIGTERM')).resolves.toBe(true)
  await expect(router.clearBufferAuthorityExact(id, access)).resolves.toBe(true)
  await expect(router.killAuthorityExact(id, access, { immediate: true })).resolves.toBe(true)
  expect(adapter.writeAuthorityExact).toHaveBeenCalledWith(id, access, 'input')
  expect(adapter.resizeAuthorityExact).toHaveBeenCalledWith(id, access, 120, 40)
  expect(adapter.sendSignalAuthorityExact).toHaveBeenCalledWith(id, access, 'SIGTERM')
  expect(adapter.clearBufferAuthorityExact).toHaveBeenCalledWith(id, access)
  expect(adapter.killAuthorityExact).toHaveBeenCalledWith(id, access, { immediate: true })
}

describe('DaemonPtyRouter authority routing', () => {
  it('forwards exact and authority operations to uniquely routed current and legacy adapters', async () => {
    const current = createAdapter([listed('current-session', 'current-incarnation', {})])
    const legacy = createAdapter([listed('legacy-session', 'legacy-incarnation', {})])
    const router = new DaemonPtyRouter({ current, legacy: [legacy] })
    await router.listProcesses()

    expect(router.writeExact('current-session', 'current-incarnation', 'exact')).toBe(true)
    expect(router.resizeExact('legacy-session', 'legacy-incarnation', 100, 30)).toBe(true)
    await expect(
      router.sendSignalExact('current-session', 'current-incarnation', 'SIGINT')
    ).resolves.toBe(true)
    await expect(router.clearBufferExact('legacy-session', 'legacy-incarnation')).resolves.toBe(
      true
    )
    await expect(
      router.killExact('current-session', 'current-incarnation', { immediate: true })
    ).resolves.toBe(true)
    await expectAuthorityOperations(router, current, 'current-session', 'current-incarnation')
    await expectAuthorityOperations(router, legacy, 'legacy-session', 'legacy-incarnation')
  })

  it('fails closed for a same-id adapter collision', async () => {
    const access = authorityAccess('collision', 'incarnation')
    const current = createAdapter([listed('collision', 'incarnation', {})])
    const legacy = createAdapter([listed('collision', 'incarnation', {})])
    const router = new DaemonPtyRouter({ current, legacy: [legacy] })

    const inventory = await router.listProcesses()

    expect(inventory.every((row) => row.mutationRouteToken === undefined)).toBe(true)
    expect(router.getPtyMutationRouteToken('collision')).toBeNull()
    expect(router.writeExact('collision', 'incarnation', 'blocked')).toBe(false)
    expect(router.writeAuthorityExact('collision', access, 'blocked')).toBe(false)
    expect(router.bindTerminalSessionAuthorityAccess('collision', access)).toBe(false)
    expect(current.writeExact).not.toHaveBeenCalled()
    expect(legacy.writeExact).not.toHaveBeenCalled()
    expect(current.writeAuthorityExact).not.toHaveBeenCalled()
    expect(legacy.writeAuthorityExact).not.toHaveBeenCalled()
  })

  it('invalidates exact routing when the owning adapter is replaced', async () => {
    const token = {}
    const access = authorityAccess('replaced', 'incarnation')
    const current = createAdapter([listed('replaced', 'incarnation', token)])
    const router = new DaemonPtyRouter({ current, legacy: [] })
    const [row] = await router.listProcesses()
    current.emitIdentityChange()

    expect(row?.mutationRouteToken).toBe(token)
    expect(router.getPtyMutationRouteToken('replaced')).toBeNull()
    expect(router.writeExact('replaced', 'incarnation', 'blocked')).toBe(false)
    expect(router.writeAuthorityExact('replaced', access, 'blocked')).toBe(false)
    expect(router.bindTerminalSessionAuthorityAccess('replaced', access)).toBe(false)
  })

  it('uses authority-exact kill during a worktree inventory sweep', async () => {
    const worktreeId = 'repo-id::/worktree'
    const id = `${worktreeId}@@pty`
    const current = createAdapter([listed(id, 'incarnation', {}, worktreeId)])
    const router = new DaemonPtyRouter({ current, legacy: [] })

    await expect(
      sweepProviderPtysForWorktree(
        worktreeId,
        router,
        Date.now() + 5_000,
        Date.now() + 4_000,
        async (_ptyId, stop) => ({ stopped: await stop(), owner: true }),
        undefined,
        true,
        () => router.listProcesses()
      )
    ).resolves.toBe(1)
    expect(current.killAuthorityExact).toHaveBeenCalledOnce()
    expect(current.killExact).not.toHaveBeenCalled()
  })

  it('preserves the admitted incarnation through router data fanout', () => {
    const current = createAdapter([])
    const legacy = createAdapter([])
    const router = new DaemonPtyRouter({ current, legacy: [legacy] })
    const received: ExactDataEvent[] = []
    router.onData((payload) => received.push(payload))

    legacy.emitData({ id: 'same-id', data: 'successor', incarnationId: 'incarnation-b' })

    expect(received).toEqual([{ id: 'same-id', data: 'successor', incarnationId: 'incarnation-b' }])
  })
})
