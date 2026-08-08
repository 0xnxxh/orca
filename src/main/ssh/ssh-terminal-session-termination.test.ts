import { describe, expect, it, vi } from 'vitest'
import type { IPtyProvider, PtyProcessInfo } from '../providers/types'
import type { SshRemotePtyLease } from '../../shared/ssh-types'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'
import { terminateListedSshTerminalSessions } from './ssh-terminal-session-termination'

const authorityAccess: TerminalSessionAuthorityPtyAccess = {
  namespace: { authorityHostId: 'host-1', namespaceId: 'namespace-1' },
  pane: { paneKey: 'pane-1', paneGenerationId: 'renderer:1' },
  binding: {
    ownerIncarnationId: 'owner-1',
    physicalPtyId: 'pty-1',
    ptyIncarnationId: 'incarnation-1'
  }
}

function lease(overrides: Partial<SshRemotePtyLease> = {}): SshRemotePtyLease {
  return {
    targetId: 'ssh-1',
    ptyId: 'pty-1',
    incarnationId: 'incarnation-1',
    state: 'detached',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function provider(input: {
  list: () => Promise<PtyProcessInfo[]>
  killExact?: (id: string, incarnationId: string) => boolean | Promise<boolean>
  killAuthorityExact?: (id: string, access: TerminalSessionAuthorityPtyAccess) => boolean
  listedRouteToken?: object
  currentRouteToken?: () => object | null
}): IPtyProvider {
  const listedRouteToken = input.listedRouteToken ?? Object.freeze({})
  return {
    listProcesses: vi.fn(async () =>
      (await input.list()).map((session) => ({
        ...session,
        mutationRouteToken: listedRouteToken
      }))
    ),
    getPtyMutationRouteToken: vi.fn(input.currentRouteToken ?? (() => listedRouteToken)),
    killExact: vi.fn(input.killExact ?? (async () => true)),
    killAuthorityExact: vi.fn(input.killAuthorityExact ?? (() => true))
  } as unknown as IPtyProvider
}

describe('SSH terminal session termination', () => {
  it('kills the exact inventory incarnation and deduplicates tracked and leased IDs', async () => {
    const ptyProvider = provider({
      list: async () => [
        {
          id: 'ssh:ssh-1@@pty-1',
          incarnationId: 'incarnation-1',
          cwd: '/remote',
          title: 'shell'
        }
      ]
    })

    await expect(
      terminateListedSshTerminalSessions({
        targetId: 'ssh-1',
        provider: ptyProvider,
        trackedPtyIds: ['ssh:ssh-1@@pty-1'],
        leases: [lease()]
      })
    ).resolves.toEqual([
      {
        relayPtyId: 'pty-1',
        appPtyId: 'ssh:ssh-1@@pty-1',
        status: 'terminated'
      }
    ])

    expect(ptyProvider.killExact).toHaveBeenCalledOnce()
    expect(ptyProvider.killExact).toHaveBeenCalledWith('ssh:ssh-1@@pty-1', 'incarnation-1', {
      immediate: true,
      keepHistory: false
    })
  })

  it('does not kill a successor whose reused ID conflicts with persisted lease evidence', async () => {
    const ptyProvider = provider({
      list: async () => [
        { id: 'ssh:ssh-1@@pty-1', incarnationId: 'incarnation-2', cwd: '/new', title: 'shell' }
      ]
    })

    const result = await terminateListedSshTerminalSessions({
      targetId: 'ssh-1',
      provider: ptyProvider,
      trackedPtyIds: [],
      leases: [lease()]
    })

    expect(result).toMatchObject([{ relayPtyId: 'pty-1', status: 'rejected' }])
    expect(ptyProvider.killExact).not.toHaveBeenCalled()
  })

  it('does not kill a same-incarnation successor with different authority access', async () => {
    const expectedAccess: TerminalSessionAuthorityPtyAccess = {
      namespace: { authorityHostId: 'host-1', namespaceId: 'namespace-1' },
      pane: { paneKey: 'pane-1', paneGenerationId: 'renderer:1' },
      binding: {
        ownerIncarnationId: 'owner-1',
        physicalPtyId: 'pty-1',
        ptyIncarnationId: 'incarnation-1'
      }
    }
    const successorAccess: TerminalSessionAuthorityPtyAccess = {
      ...expectedAccess,
      pane: { ...expectedAccess.pane, paneGenerationId: 'renderer:2' }
    }
    const ptyProvider = provider({
      list: async () => [
        {
          id: 'ssh:ssh-1@@pty-1',
          incarnationId: 'incarnation-1',
          terminalSessionAuthorityAccess: successorAccess,
          cwd: '/new',
          title: 'shell'
        }
      ]
    })

    const result = await terminateListedSshTerminalSessions({
      targetId: 'ssh-1',
      provider: ptyProvider,
      trackedPtyIds: [],
      leases: [lease({ terminalSessionAuthorityAccess: expectedAccess })]
    })

    expect(result).toMatchObject([{ relayPtyId: 'pty-1', status: 'rejected' }])
    expect(ptyProvider.killAuthorityExact).not.toHaveBeenCalled()
    expect(ptyProvider.killExact).not.toHaveBeenCalled()
  })

  it('fails closed when the listed incarnation is replaced before mutation', async () => {
    let currentIncarnation = 'incarnation-1'
    const ptyProvider = provider({
      list: async () => {
        const listed = [
          { id: 'ssh:ssh-1@@pty-1', incarnationId: currentIncarnation, cwd: '/old', title: 'shell' }
        ]
        currentIncarnation = 'incarnation-2'
        return listed
      },
      killExact: async (_id, incarnationId) => incarnationId === currentIncarnation
    })

    const result = await terminateListedSshTerminalSessions({
      targetId: 'ssh-1',
      provider: ptyProvider,
      trackedPtyIds: ['pty-1'],
      leases: []
    })

    expect(result).toMatchObject([{ relayPtyId: 'pty-1', status: 'rejected' }])
    expect(ptyProvider.killExact).toHaveBeenCalledWith(
      'ssh:ssh-1@@pty-1',
      'incarnation-1',
      expect.any(Object)
    )
  })

  it('rejects a list result after its provider route is replaced', async () => {
    const listedRouteToken = Object.freeze({})
    const ptyProvider = provider({
      listedRouteToken,
      currentRouteToken: () => Object.freeze({}),
      list: async () => [
        {
          id: 'ssh:ssh-1@@pty-1',
          incarnationId: 'incarnation-1',
          cwd: '/remote',
          title: 'shell'
        }
      ]
    })

    const result = await terminateListedSshTerminalSessions({
      targetId: 'ssh-1',
      provider: ptyProvider,
      trackedPtyIds: ['pty-1'],
      leases: []
    })

    expect(result).toMatchObject([{ relayPtyId: 'pty-1', status: 'rejected' }])
    expect(ptyProvider.killExact).not.toHaveBeenCalled()
  })

  it('rejects a replay whose provider is superseded after inventory', async () => {
    let current = true
    const ptyProvider = provider({
      list: async () => {
        current = false
        return [
          {
            id: 'ssh:ssh-1@@pty-1',
            incarnationId: 'incarnation-1',
            terminalSessionAuthorityAccess: authorityAccess,
            cwd: '/remote',
            title: 'shell'
          }
        ]
      }
    })

    await expect(
      terminateListedSshTerminalSessions({
        targetId: 'ssh-1',
        provider: ptyProvider,
        trackedPtyIds: [],
        leases: [lease({ terminalSessionAuthorityAccess: authorityAccess })],
        isCurrent: () => current,
        prepareAuthorityExitWait: vi.fn()
      })
    ).rejects.toThrow('ssh_pty_termination_provider_superseded')
    expect(ptyProvider.killAuthorityExact).not.toHaveBeenCalled()
    expect(ptyProvider.killExact).not.toHaveBeenCalled()
  })

  it('rejects an authority kill before mutation when its outcome wait is unavailable', async () => {
    const ptyProvider = provider({
      list: async () => [
        {
          id: 'ssh:ssh-1@@pty-1',
          incarnationId: 'incarnation-1',
          terminalSessionAuthorityAccess: authorityAccess,
          cwd: '/remote',
          title: 'shell'
        }
      ]
    })

    const result = await terminateListedSshTerminalSessions({
      targetId: 'ssh-1',
      provider: ptyProvider,
      trackedPtyIds: ['pty-1'],
      leases: []
    })

    expect(result).toMatchObject([{ relayPtyId: 'pty-1', status: 'rejected' }])

    expect(
      (ptyProvider as unknown as { killAuthorityExact: ReturnType<typeof vi.fn> })
        .killAuthorityExact
    ).not.toHaveBeenCalled()
    expect(ptyProvider.killExact).not.toHaveBeenCalled()
  })

  it('marks an authority kill terminated only after its exact exit outcome', async () => {
    const ptyProvider = provider({
      list: async () => [
        {
          id: 'ssh:ssh-1@@pty-1',
          incarnationId: 'incarnation-1',
          terminalSessionAuthorityAccess: authorityAccess,
          cwd: '/remote',
          title: 'shell'
        }
      ]
    })
    const cancelUnsent = vi.fn()
    const dispose = vi.fn()
    const prepareAuthorityExitWait = vi.fn(() => ({
      completion: Promise.resolve(true),
      cancelUnsent,
      dispose
    }))

    await expect(
      terminateListedSshTerminalSessions({
        targetId: 'ssh-1',
        provider: ptyProvider,
        trackedPtyIds: ['pty-1'],
        leases: [],
        prepareAuthorityExitWait
      })
    ).resolves.toMatchObject([{ relayPtyId: 'pty-1', status: 'terminated' }])
    expect(prepareAuthorityExitWait).toHaveBeenCalledWith({
      targetId: 'ssh-1',
      relayPtyId: 'pty-1',
      appPtyId: 'ssh:ssh-1@@pty-1',
      authorityAccess
    })
    expect(ptyProvider.killAuthorityExact).toHaveBeenCalledWith(
      'ssh:ssh-1@@pty-1',
      authorityAccess,
      { immediate: true, keepHistory: false }
    )
    expect(ptyProvider.killExact).not.toHaveBeenCalled()
    expect(cancelUnsent).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('cancels exact close intent when an authority mutation is definitively rejected', async () => {
    const ptyProvider = provider({
      list: async () => [
        {
          id: 'ssh:ssh-1@@pty-1',
          incarnationId: 'incarnation-1',
          terminalSessionAuthorityAccess: authorityAccess,
          cwd: '/remote',
          title: 'shell'
        }
      ],
      killAuthorityExact: () => false
    })
    const cancelUnsent = vi.fn()
    const dispose = vi.fn()

    await expect(
      terminateListedSshTerminalSessions({
        targetId: 'ssh-1',
        provider: ptyProvider,
        trackedPtyIds: ['pty-1'],
        leases: [],
        prepareAuthorityExitWait: () => ({
          completion: Promise.resolve(true),
          cancelUnsent,
          dispose
        })
      })
    ).resolves.toMatchObject([{ relayPtyId: 'pty-1', status: 'rejected' }])

    expect(cancelUnsent).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('retains exact close intent when authority mutation delivery is ambiguous', async () => {
    const ptyProvider = provider({
      list: async () => [
        {
          id: 'ssh:ssh-1@@pty-1',
          incarnationId: 'incarnation-1',
          terminalSessionAuthorityAccess: authorityAccess,
          cwd: '/remote',
          title: 'shell'
        }
      ],
      killAuthorityExact: () => {
        throw new Error('transport lost during mutation')
      }
    })
    const cancelUnsent = vi.fn()
    const dispose = vi.fn()

    await expect(
      terminateListedSshTerminalSessions({
        targetId: 'ssh-1',
        provider: ptyProvider,
        trackedPtyIds: ['pty-1'],
        leases: [],
        prepareAuthorityExitWait: () => ({
          completion: Promise.resolve(true),
          cancelUnsent,
          dispose
        })
      })
    ).resolves.toMatchObject([
      {
        relayPtyId: 'pty-1',
        status: 'rejected',
        error: expect.objectContaining({ message: 'transport lost during mutation' })
      }
    ])

    expect(cancelUnsent).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('keeps an accepted authority kill pending when its durable wait times out', async () => {
    const ptyProvider = provider({
      list: async () => [
        {
          id: 'ssh:ssh-1@@pty-1',
          incarnationId: 'incarnation-1',
          terminalSessionAuthorityAccess: authorityAccess,
          cwd: '/remote',
          title: 'shell'
        }
      ]
    })
    const cancelUnsent = vi.fn()
    const dispose = vi.fn()

    await expect(
      terminateListedSshTerminalSessions({
        targetId: 'ssh-1',
        provider: ptyProvider,
        trackedPtyIds: ['pty-1'],
        leases: [],
        prepareAuthorityExitWait: () => ({
          completion: Promise.resolve(false),
          cancelUnsent,
          dispose
        })
      })
    ).resolves.toMatchObject([{ relayPtyId: 'pty-1', status: 'acceptedPending' }])

    expect(cancelUnsent).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('keeps an accepted authority kill pending when outcome delivery fails', async () => {
    const ptyProvider = provider({
      list: async () => [
        {
          id: 'ssh:ssh-1@@pty-1',
          incarnationId: 'incarnation-1',
          terminalSessionAuthorityAccess: authorityAccess,
          cwd: '/remote',
          title: 'shell'
        }
      ]
    })
    const cancelUnsent = vi.fn()
    const dispose = vi.fn()

    await expect(
      terminateListedSshTerminalSessions({
        targetId: 'ssh-1',
        provider: ptyProvider,
        trackedPtyIds: ['pty-1'],
        leases: [],
        prepareAuthorityExitWait: () => ({
          completion: Promise.reject(new Error('transport lost before durable outcome')),
          cancelUnsent,
          dispose
        })
      })
    ).resolves.toMatchObject([
      {
        relayPtyId: 'pty-1',
        status: 'acceptedPending',
        error: expect.objectContaining({ message: 'transport lost before durable outcome' })
      }
    ])
    expect(cancelUnsent).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('treats inventory absence as unknown without issuing a mutation', async () => {
    const ptyProvider = provider({ list: async () => [] })

    await expect(
      terminateListedSshTerminalSessions({
        targetId: 'ssh-1',
        provider: ptyProvider,
        trackedPtyIds: [],
        leases: [lease({ state: 'expired' })]
      })
    ).resolves.toMatchObject([{ relayPtyId: 'pty-1', status: 'unknown' }])
    expect(ptyProvider.killExact).not.toHaveBeenCalled()
  })

  it('treats a not-found mutation response as unknown', async () => {
    const ptyProvider = provider({
      list: async () => [
        {
          id: 'ssh:ssh-1@@pty-1',
          incarnationId: 'incarnation-1',
          cwd: '/remote',
          title: 'shell'
        }
      ],
      killExact: async () => {
        throw new Error('PTY "pty-1" not found')
      }
    })

    await expect(
      terminateListedSshTerminalSessions({
        targetId: 'ssh-1',
        provider: ptyProvider,
        trackedPtyIds: [],
        leases: [lease()]
      })
    ).resolves.toMatchObject([{ relayPtyId: 'pty-1', status: 'unknown' }])
  })
})
