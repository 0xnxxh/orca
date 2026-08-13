import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiVaultListResult, AiVaultSession } from '../../shared/ai-vault-types'

const mocks = vi.hoisted(() => ({
  callRuntimeEnvironment: vi.fn(),
  listEnvironments: vi.fn()
}))

vi.mock('../../shared/runtime-environment-store', () => ({
  listEnvironments: mocks.listEnvironments
}))

vi.mock('../ipc/runtime-environment-transport-routing', () => ({
  callRuntimeEnvironment: mocks.callRuntimeEnvironment
}))

const {
  findRuntimeOwningSshAiVaultHost,
  listRuntimeOwnedSshAiVaultTargets,
  scanRuntimeOwnedSshAiVaultSessions
} = await import('./runtime-owned-ssh-session-list')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listEnvironments.mockReturnValue([{ id: 'hub-runtime' }])
  mocks.callRuntimeEnvironment.mockResolvedValue({
    ok: true,
    result: { targets: [{ id: 'hub-owned-host', label: 'Hub host' }] }
  })
})

describe('runtime-owned SSH AI Vault inventory', () => {
  it('lists SSH targets owned by a paired runtime and skips recipe-VM ids', async () => {
    mocks.callRuntimeEnvironment.mockResolvedValueOnce({
      ok: true,
      result: {
        targets: [
          { id: 'hub-owned-host', label: 'Hub host', connected: true },
          { id: 'offline-host', label: 'Offline', connected: false },
          { id: 'runtime-ssh-recipe', label: 'Recipe VM', connected: true }
        ]
      }
    })

    await expect(listRuntimeOwnedSshAiVaultTargets('/user-data', 'hub-runtime')).resolves.toEqual([
      {
        environmentId: 'hub-runtime',
        targetId: 'hub-owned-host',
        executionHostId: 'ssh:hub-owned-host',
        connected: true
      },
      {
        environmentId: 'hub-runtime',
        targetId: 'offline-host',
        executionHostId: 'ssh:offline-host',
        connected: false
      }
    ])
  })

  it('finds which paired runtime registered an SSH target', async () => {
    await expect(findRuntimeOwningSshAiVaultHost('/user-data', 'hub-owned-host')).resolves.toEqual({
      environmentId: 'hub-runtime',
      targetId: 'hub-owned-host',
      executionHostId: 'ssh:hub-owned-host'
    })
    expect(mocks.callRuntimeEnvironment).toHaveBeenCalledWith(
      '/user-data',
      'hub-runtime',
      'ssh.listTargetSummaries',
      undefined,
      undefined
    )
  })

  it('does not treat recipe-VM targets as runtime-owned SSH history hosts', async () => {
    await expect(findRuntimeOwningSshAiVaultHost('/user-data', 'runtime-ssh-recipe')).resolves.toBe(
      null
    )
    expect(mocks.callRuntimeEnvironment).not.toHaveBeenCalled()
  })

  it('asks the owning runtime to scan a named SSH host and keeps the SSH stamp', async () => {
    mocks.callRuntimeEnvironment.mockResolvedValueOnce({
      ok: true,
      result: result([session('local', 'ssh-session')])
    })

    const scanned = await scanRuntimeOwnedSshAiVaultSessions(
      '/user-data',
      'hub-runtime',
      'hub-owned-host',
      { limit: 25, force: true }
    )

    expect(mocks.callRuntimeEnvironment).toHaveBeenCalledWith(
      '/user-data',
      'hub-runtime',
      'aiVault.listSessions',
      {
        limit: 25,
        force: true,
        executionHostId: 'ssh:hub-owned-host'
      },
      undefined
    )
    expect(scanned.sessions).toEqual([
      expect.objectContaining({
        executionHostId: 'ssh:hub-owned-host',
        sessionId: 'ssh-session'
      })
    ])
  })

  it('turns a runtime transport throw into an SSH-host issue', async () => {
    mocks.callRuntimeEnvironment.mockRejectedValueOnce(new Error('runtime connect timed out'))

    const scanned = await scanRuntimeOwnedSshAiVaultSessions(
      '/user-data',
      'hub-runtime',
      'hub-owned-host',
      {}
    )

    expect(scanned.sessions).toEqual([])
    expect(scanned.issues).toEqual([
      expect.objectContaining({
        executionHostId: 'ssh:hub-owned-host',
        message: 'runtime connect timed out'
      })
    ])
  })

  it('turns an old-runtime host-id rejection into an SSH-host issue', async () => {
    mocks.callRuntimeEnvironment.mockResolvedValueOnce({
      ok: false,
      error: { message: 'Invalid runtime execution host id' }
    })

    const scanned = await scanRuntimeOwnedSshAiVaultSessions(
      '/user-data',
      'hub-runtime',
      'hub-owned-host',
      {}
    )

    expect(scanned.sessions).toEqual([])
    expect(scanned.issues).toEqual([
      expect.objectContaining({
        executionHostId: 'ssh:hub-owned-host',
        path: 'hub-owned-host',
        message: expect.stringContaining('cannot scan Agent Session History on its SSH hosts')
      })
    ])
  })
})

function result(sessions: AiVaultSession[]): AiVaultListResult {
  return { sessions, issues: [], scannedAt: '2026-08-12T00:00:00.000Z' }
}

function session(
  executionHostId: AiVaultSession['executionHostId'],
  sessionId: string
): AiVaultSession {
  return {
    id: `${executionHostId}:codex:${sessionId}:/sessions/${sessionId}.jsonl`,
    executionHostId,
    executionHostPlatform: 'linux',
    agent: 'codex',
    sessionId,
    title: sessionId,
    cwd: '/srv/app',
    branch: null,
    model: null,
    filePath: `/sessions/${sessionId}.jsonl`,
    codexHome: null,
    createdAt: null,
    updatedAt: '2026-08-12T03:00:00.000Z',
    modifiedAt: '2026-08-12T00:00:00.000Z',
    messageCount: 1,
    totalTokens: 0,
    previewMessages: [],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: `codex resume ${sessionId}`,
    subagent: null
  }
}
