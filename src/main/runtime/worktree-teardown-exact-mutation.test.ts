import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'

const { listRegisteredPtysMock } = vi.hoisted(() => ({
  listRegisteredPtysMock: vi.fn()
}))

vi.mock('../memory/pty-registry', () => ({
  listRegisteredPtys: listRegisteredPtysMock
}))

import { killAllProcessesForWorktree } from './worktree-teardown'
import { createWorktreeTeardownProviderStub } from './__tests__/worktree-teardown-provider'

describe('worktree teardown exact mutations', () => {
  beforeEach(() => listRegisteredPtysMock.mockReset())

  it('does not kill a same-ID successor installed after provider inventory', async () => {
    let currentIncarnation = 'incarnation-old'
    const localProvider = createWorktreeTeardownProviderStub(async () => {
      const listedIncarnation = currentIncarnation
      currentIncarnation = 'incarnation-new'
      return [
        {
          id: 'w1@@reused',
          incarnationId: listedIncarnation,
          cwd: '/tmp/w1',
          title: 'shell',
          worktreeId: 'w1'
        }
      ]
    })
    localProvider.killExact.mockImplementation(
      async (_id: string, incarnationId: string) => incarnationId === currentIncarnation
    )
    listRegisteredPtysMock.mockReturnValue([])

    const result = await killAllProcessesForWorktree('w1', {
      localProvider,
      includeLocalRegistry: false
    })

    expect(result.providerStopped).toBe(0)
    expect(localProvider.killExact).toHaveBeenCalledWith(
      'w1@@reused',
      'incarnation-old',
      expect.objectContaining({ immediate: true })
    )
    expect(localProvider.shutdown).not.toHaveBeenCalled()
  })

  it('never mutates duplicate provider inventory identities', async () => {
    const localProvider = createWorktreeTeardownProviderStub(async () => [
      {
        id: 'w1@@duplicate',
        incarnationId: 'incarnation-1',
        cwd: '/tmp/w1',
        title: 'shell',
        worktreeId: 'w1'
      },
      {
        id: 'w1@@duplicate',
        incarnationId: 'incarnation-2',
        cwd: '/tmp/w1',
        title: 'shell',
        worktreeId: 'w1'
      }
    ])
    listRegisteredPtysMock.mockReturnValue([])

    await expect(
      killAllProcessesForWorktree('w1', {
        localProvider,
        includeLocalRegistry: false
      })
    ).resolves.toEqual({ runtimeStopped: 0, providerStopped: 0, registryStopped: 0 })
    expect(localProvider.killExact).not.toHaveBeenCalled()

    await expect(
      killAllProcessesForWorktree('w1', {
        localProvider,
        includeLocalRegistry: false,
        requirePhysicalStop: true
      })
    ).rejects.toThrow(/worktree_pty_inventory_ambiguous:w1@@duplicate/)
    expect(localProvider.killExact).not.toHaveBeenCalled()
    expect(localProvider.killAuthorityExact).not.toHaveBeenCalled()
  })

  it('fences the registry sweep with the provider-listed incarnation', async () => {
    let currentIncarnation = 'incarnation-old'
    const localProvider = createWorktreeTeardownProviderStub(async () => {
      const listedIncarnation = currentIncarnation
      currentIncarnation = 'incarnation-new'
      return [
        {
          id: 'registry-reused',
          incarnationId: listedIncarnation,
          cwd: '/tmp/w1',
          title: 'shell',
          worktreeId: 'w1'
        }
      ]
    })
    localProvider.killExact.mockImplementation(
      async (_id: string, incarnationId: string) => incarnationId === currentIncarnation
    )
    listRegisteredPtysMock.mockReturnValue([
      {
        ptyId: 'registry-reused',
        worktreeId: 'w1',
        sessionId: null,
        paneKey: null,
        pid: 10
      }
    ])
    const onPtyStopped = vi.fn()

    const result = await killAllProcessesForWorktree('w1', {
      localProvider,
      includeProviderInventory: false,
      onPtyStopped
    })

    expect(result.registryStopped).toBe(0)
    expect(localProvider.killExact).toHaveBeenCalledWith(
      'registry-reused',
      'incarnation-old',
      expect.objectContaining({ immediate: true })
    )
    expect(onPtyStopped).not.toHaveBeenCalled()
    expect(localProvider.shutdown).not.toHaveBeenCalled()
  })

  it('rejects a queued inventory kill after its provider route is replaced', async () => {
    let releaseRuntimeStop: (stopped: boolean) => void = () => undefined
    const runtimeStop = new Promise<boolean>((resolve) => {
      releaseRuntimeStop = resolve
    })
    let markRuntimeClaimed: () => void = () => undefined
    const runtimeClaimed = new Promise<void>((resolve) => {
      markRuntimeClaimed = resolve
    })
    const runtime = {
      stopTerminalsForWorktree: async (
        _worktreeId: string,
        options: {
          stopPty: (
            ptyId: string,
            stop: () => Promise<boolean>
          ) => Promise<{ stopped: boolean; owner: boolean }>
        }
      ) => ({
        stopped: (
          await options.stopPty('w1@@routed', () => {
            markRuntimeClaimed()
            return runtimeStop
          })
        ).owner
          ? 1
          : 0
      })
    } as unknown as Parameters<typeof killAllProcessesForWorktree>[1]['runtime']
    const localProvider = createWorktreeTeardownProviderStub(async () => {
      await runtimeClaimed
      return [
        {
          id: 'w1@@routed',
          incarnationId: 'incarnation-old',
          cwd: '/tmp/w1',
          title: 'shell',
          worktreeId: 'w1'
        }
      ]
    })
    listRegisteredPtysMock.mockReturnValue([])

    const teardown = killAllProcessesForWorktree('w1', {
      runtime,
      localProvider,
      includeLocalRegistry: false
    })
    await vi.waitFor(() => expect(localProvider.listProcesses).toHaveBeenCalledOnce())
    await runtimeClaimed
    localProvider.setMutationRouteToken(Object.freeze({}))
    releaseRuntimeStop(false)

    await expect(teardown).resolves.toEqual({
      runtimeStopped: 0,
      providerStopped: 0,
      registryStopped: 0
    })
    expect(localProvider.killExact).not.toHaveBeenCalled()
    expect(localProvider.shutdown).not.toHaveBeenCalled()
  })

  it('does not let a stale registry row kill another worktree same-ID successor', async () => {
    const localProvider = createWorktreeTeardownProviderStub(async () => [
      {
        id: 'registry-reused',
        incarnationId: 'incarnation-successor',
        cwd: '/tmp/w2',
        title: 'shell',
        worktreeId: 'w2'
      }
    ])
    listRegisteredPtysMock.mockReturnValue([
      {
        ptyId: 'registry-reused',
        worktreeId: 'w1',
        sessionId: null,
        paneKey: null,
        pid: 10
      }
    ])
    const onPtyStopped = vi.fn()

    const result = await killAllProcessesForWorktree('w1', {
      localProvider,
      includeProviderInventory: false,
      onPtyStopped
    })

    expect(result.registryStopped).toBe(0)
    expect(localProvider.killExact).not.toHaveBeenCalled()
    expect(localProvider.shutdown).not.toHaveBeenCalled()
    expect(onPtyStopped).not.toHaveBeenCalled()
  })

  it('blocks destructive teardown on a registry owner conflict', async () => {
    const localProvider = createWorktreeTeardownProviderStub(async () => [
      {
        id: 'registry-reused',
        incarnationId: 'incarnation-successor',
        cwd: '/tmp/w2',
        title: 'shell',
        worktreeId: 'w2'
      }
    ])
    listRegisteredPtysMock.mockReturnValue([
      {
        ptyId: 'registry-reused',
        worktreeId: 'w1',
        sessionId: null,
        paneKey: null,
        pid: 10
      }
    ])

    await expect(
      killAllProcessesForWorktree('w1', {
        localProvider,
        includeProviderInventory: false,
        requirePhysicalStop: true
      })
    ).rejects.toThrow(/worktree_pty_inventory_owner_conflict:registry-reused/)
    expect(localProvider.killExact).not.toHaveBeenCalled()
    expect(localProvider.killAuthorityExact).not.toHaveBeenCalled()
  })

  it('preserves a registry row when provider inventory omits it', async () => {
    const localProvider = createWorktreeTeardownProviderStub(async () => [])
    listRegisteredPtysMock.mockReturnValue([
      {
        ptyId: 'registry-unknown',
        worktreeId: 'w1',
        sessionId: null,
        paneKey: null,
        pid: 10
      }
    ])
    const onPtyStopped = vi.fn()

    await expect(
      killAllProcessesForWorktree('w1', {
        localProvider,
        includeProviderInventory: false,
        onPtyStopped
      })
    ).resolves.toEqual({ runtimeStopped: 0, providerStopped: 0, registryStopped: 0 })

    expect(localProvider.killExact).not.toHaveBeenCalled()
    expect(localProvider.killAuthorityExact).not.toHaveBeenCalled()
    expect(localProvider.shutdown).not.toHaveBeenCalled()
    expect(onPtyStopped).not.toHaveBeenCalled()
  })

  it('blocks destructive teardown when provider inventory omits a registered PTY', async () => {
    const localProvider = createWorktreeTeardownProviderStub(async () => [])
    listRegisteredPtysMock.mockReturnValue([
      {
        ptyId: 'registry-unknown',
        worktreeId: 'w1',
        sessionId: null,
        paneKey: null,
        pid: 10
      }
    ])
    const onPtyStopped = vi.fn()

    await expect(
      killAllProcessesForWorktree('w1', {
        localProvider,
        includeProviderInventory: false,
        onPtyStopped,
        requirePhysicalStop: true
      })
    ).rejects.toThrow(/registry-unknown/)

    expect(localProvider.killExact).not.toHaveBeenCalled()
    expect(localProvider.killAuthorityExact).not.toHaveBeenCalled()
    expect(localProvider.shutdown).not.toHaveBeenCalled()
    expect(onPtyStopped).not.toHaveBeenCalled()
  })

  it('carries full authority access from provider inventory into the kill', async () => {
    const authorityAccess: TerminalSessionAuthorityPtyAccess = {
      namespace: { authorityHostId: 'host-1', namespaceId: 'namespace-1' },
      pane: { paneKey: 'pane-1', paneGenerationId: 'renderer:1' },
      binding: {
        ownerIncarnationId: 'owner-1',
        physicalPtyId: 'w1@@authority',
        ptyIncarnationId: 'authority-incarnation'
      }
    }
    const localProvider = createWorktreeTeardownProviderStub(async () => [
      {
        id: 'w1@@authority',
        incarnationId: 'authority-incarnation',
        terminalSessionAuthorityAccess: authorityAccess,
        cwd: '/tmp/w1',
        title: 'shell',
        worktreeId: 'w1'
      }
    ])
    listRegisteredPtysMock.mockReturnValue([])

    await killAllProcessesForWorktree('w1', {
      localProvider,
      includeLocalRegistry: false
    })

    expect(localProvider.killAuthorityExact).toHaveBeenCalledWith(
      'w1@@authority',
      authorityAccess,
      expect.objectContaining({ immediate: true })
    )
    expect(localProvider.killExact).not.toHaveBeenCalled()
  })

  it('does not clear a same-ID successor with different authority access', async () => {
    const oldAccess: TerminalSessionAuthorityPtyAccess = {
      namespace: { authorityHostId: 'host-1', namespaceId: 'namespace-1' },
      pane: { paneKey: 'pane-1', paneGenerationId: 'renderer:1' },
      binding: {
        ownerIncarnationId: 'owner-1',
        physicalPtyId: 'w1@@authority',
        ptyIncarnationId: 'authority-incarnation'
      }
    }
    const successorAccess: TerminalSessionAuthorityPtyAccess = {
      ...oldAccess,
      pane: { ...oldAccess.pane, paneGenerationId: 'renderer:2' }
    }
    let currentAccess = oldAccess
    const localProvider = createWorktreeTeardownProviderStub(async () => {
      const listedAccess = currentAccess
      currentAccess = successorAccess
      return [
        {
          id: 'w1@@authority',
          incarnationId: 'authority-incarnation',
          terminalSessionAuthorityAccess: listedAccess,
          cwd: '/tmp/w1',
          title: 'shell',
          worktreeId: 'w1'
        }
      ]
    })
    localProvider.killAuthorityExact.mockImplementation(
      async (_id: string, access: TerminalSessionAuthorityPtyAccess) =>
        access.pane.paneGenerationId === currentAccess.pane.paneGenerationId
    )
    listRegisteredPtysMock.mockReturnValue([])
    const onPtyStopped = vi.fn()

    const result = await killAllProcessesForWorktree('w1', {
      localProvider,
      includeLocalRegistry: false,
      onPtyStopped
    })

    expect(result.providerStopped).toBe(0)
    expect(localProvider.killAuthorityExact).toHaveBeenCalledWith(
      'w1@@authority',
      oldAccess,
      expect.objectContaining({ immediate: true })
    )
    expect(onPtyStopped).not.toHaveBeenCalled()
    expect(localProvider.shutdown).not.toHaveBeenCalled()
  })
})
