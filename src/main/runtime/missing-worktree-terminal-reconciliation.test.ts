import { describe, expect, it, vi } from 'vitest'
import type { IPtyProvider } from '../providers/types'
import type { Repo } from '../../shared/types'
import type { OrcaRuntimeService } from './orca-runtime'
import { stopMissingWorktreeTerminals } from './missing-worktree-terminal-reconciliation'

function createProvider(sessionIds: string[]): IPtyProvider {
  return {
    listProcesses: vi.fn(async () =>
      sessionIds.map((id) => ({ id, cwd: '/workspace', title: 'shell' }))
    ),
    shutdown: vi.fn(async () => {})
  } as unknown as IPtyProvider
}

function createRuntime(): OrcaRuntimeService {
  return {
    stopTerminalsForWorktree: vi.fn(async () => ({ stopped: 0 }))
  } as unknown as OrcaRuntimeService
}

const localRepo: Repo = {
  id: 'repo-1',
  path: '/workspace/repo',
  displayName: 'Repo',
  badgeColor: '#000',
  addedAt: 1
}

describe('stopMissingWorktreeTerminals', () => {
  it('stops only locally owned worktrees absent from the authoritative scan', async () => {
    const deletedId = 'repo-1::/workspace/deleted'
    const survivingId = 'repo-1::/workspace/surviving'
    const provider = createProvider([
      `${deletedId}@@deleted-session`,
      `${survivingId}@@surviving-session`
    ])
    const runtime = createRuntime()

    const result = await stopMissingWorktreeTerminals(
      localRepo,
      [deletedId, survivingId, 'repo-2::/workspace/other'],
      [survivingId],
      {
        runtime,
        getLocalProvider: () => provider,
        getSshProvider: () => undefined
      }
    )

    expect(result).toEqual({ stoppedWorktreeIds: [deletedId] })
    expect(provider.shutdown).toHaveBeenCalledWith(
      `${deletedId}@@deleted-session`,
      expect.objectContaining({ immediate: true })
    )
    expect(provider.shutdown).not.toHaveBeenCalledWith(
      `${survivingId}@@surviving-session`,
      expect.anything()
    )
  })

  it('uses the owning SSH provider without consulting the local provider', async () => {
    const deletedId = 'repo-1::/workspace/deleted'
    const localProvider = createProvider([`${deletedId}@@local-session`])
    const sshProvider = createProvider([`${deletedId}@@ssh-session`])
    const getSshProvider = vi.fn(() => sshProvider)

    await stopMissingWorktreeTerminals({ ...localRepo, connectionId: 'ssh-1' }, [deletedId], [], {
      runtime: createRuntime(),
      getLocalProvider: () => localProvider,
      getSshProvider
    })

    expect(getSshProvider).toHaveBeenCalledWith('ssh-1')
    expect(sshProvider.shutdown).toHaveBeenCalledWith(
      `${deletedId}@@ssh-session`,
      expect.objectContaining({ immediate: true })
    )
    expect(localProvider.listProcesses).not.toHaveBeenCalled()
  })

  it('still stops graph-visible sessions when the owning provider is unavailable', async () => {
    const deletedId = 'repo-1::/workspace/deleted'
    const runtime = createRuntime()

    const result = await stopMissingWorktreeTerminals(
      { ...localRepo, connectionId: 'ssh-1' },
      [deletedId],
      [],
      {
        runtime,
        getLocalProvider: () => null,
        getSshProvider: () => undefined
      }
    )

    expect(result).toEqual({ stoppedWorktreeIds: [deletedId] })
    expect(runtime.stopTerminalsForWorktree).toHaveBeenCalledWith(deletedId)
  })
})
