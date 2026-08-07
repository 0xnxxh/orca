/**
 * A fork on an SSH host used to keep `upstream === undefined` until someone opened
 * its settings page — so its GitHub Project rows stayed hidden and its fork badge
 * never rendered (#12967). Connect is the first moment the probe can succeed, so
 * the backfill runs there: best-effort, sequential, and never awaited by callers.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Repo } from '../../shared/types'
import type { SshConnectionState } from '../../shared/ssh-types'
import { OrcaRuntimeService } from './orca-runtime'
import { getRepoUpstream } from '../github/client'

const getRepoUpstreamMock = vi.hoisted(() => vi.fn())

vi.mock('../github/client', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getRepoUpstream: getRepoUpstreamMock
}))

const UPSTREAM = { owner: 'stablyai', repo: 'orca' }

function makeRepo(overrides: Partial<Repo>): Repo {
  return {
    id: 'repo',
    path: '/srv/orca',
    displayName: 'orca',
    badgeColor: '#000',
    addedAt: 1,
    kind: 'git',
    ...overrides
  } as Repo
}

function createRuntime(repos: Repo[]) {
  const updateRepo = vi.fn((id: string, updates: Partial<Repo>) => {
    const repo = repos.find((entry) => entry.id === id)
    if (!repo) {
      return null
    }
    Object.assign(repo, updates)
    return repo
  })
  const runtime = new OrcaRuntimeService({
    getRepos: () => [...repos],
    getRepo: (id: string) => repos.find((repo) => repo.id === id) ?? null,
    updateRepo,
    getAllWorktreeMeta: () => ({}),
    getWorktreeMeta: () => null,
    setWorktreeMeta: vi.fn(),
    removeWorktreeMeta: vi.fn(),
    getGitHubCache: () => null,
    getSettings: () => ({})
  } as never)
  return { runtime, repos, updateRepo }
}

function sshState(targetId: string, status: SshConnectionState['status']): SshConnectionState {
  return { targetId, status, error: null, reconnectAttempt: 0 }
}

// Why: the backfill is deliberately fire-and-forget, so tests drain the queue
// rather than awaiting a handle the production caller never has.
async function drainBackfill(): Promise<void> {
  for (let tick = 0; tick < 20; tick += 1) {
    await Promise.resolve()
  }
}

beforeEach(() => {
  getRepoUpstreamMock.mockReset()
  getRepoUpstreamMock.mockResolvedValue(null)
})

describe('fork upstream backfill for SSH repos', () => {
  it('resolves the upstream when the connection comes up', async () => {
    getRepoUpstreamMock.mockResolvedValue(UPSTREAM)
    const { runtime, repos } = createRuntime([makeRepo({ id: 'ssh-fork', connectionId: 'ssh-1' })])

    runtime.notifySshStateChanged('ssh-1', sshState('ssh-1', 'connected'))
    await drainBackfill()

    expect(getRepoUpstream).toHaveBeenCalledWith('/srv/orca', 'ssh-1')
    expect(repos[0].upstream).toEqual(UPSTREAM)
  })

  it('migrates the auto-detected origin avatar to the upstream, like the local pass', async () => {
    getRepoUpstreamMock.mockResolvedValue(UPSTREAM)
    const { runtime, repos } = createRuntime([
      makeRepo({
        id: 'ssh-fork',
        connectionId: 'ssh-1',
        repoIcon: { type: 'image', src: 'https://avatars/fork.png', source: 'github' }
      }),
      makeRepo({
        id: 'ssh-chosen',
        path: '/srv/other',
        connectionId: 'ssh-1',
        repoIcon: { type: 'emoji', emoji: '🦈' }
      })
    ])

    runtime.notifySshStateChanged('ssh-1', sshState('ssh-1', 'connected'))
    await drainBackfill()

    expect(repos[0].repoIcon).toMatchObject({ type: 'image', source: 'github' })
    expect(repos[0].repoIcon).not.toMatchObject({ src: 'https://avatars/fork.png' })
    expect(repos[1].repoIcon).toEqual({ type: 'emoji', emoji: '🦈' })
  })

  it('skips folder repos, other connections, and already-resolved repos', async () => {
    const { runtime } = createRuntime([
      makeRepo({ id: 'folder', connectionId: 'ssh-1', kind: 'folder' }),
      makeRepo({ id: 'other-host', path: '/srv/b', connectionId: 'ssh-2' }),
      makeRepo({ id: 'local', path: '/home/a' }),
      makeRepo({ id: 'resolved', path: '/srv/c', connectionId: 'ssh-1', upstream: null })
    ])

    runtime.notifySshStateChanged('ssh-1', sshState('ssh-1', 'connected'))
    await drainBackfill()

    expect(getRepoUpstream).not.toHaveBeenCalled()
  })

  it('probes each repo once, not once per reconnect', async () => {
    const { runtime } = createRuntime([makeRepo({ id: 'ssh-fork', connectionId: 'ssh-1' })])

    runtime.notifySshStateChanged('ssh-1', sshState('ssh-1', 'connected'))
    runtime.notifySshStateChanged('ssh-1', sshState('ssh-1', 'connected'))
    await drainBackfill()
    runtime.notifySshStateChanged('ssh-1', sshState('ssh-1', 'disconnected'))
    runtime.notifySshStateChanged('ssh-1', sshState('ssh-1', 'connected'))
    await drainBackfill()

    expect(getRepoUpstream).toHaveBeenCalledTimes(1)
  })

  it('retries on the next connect when the probe threw', async () => {
    getRepoUpstreamMock.mockRejectedValueOnce(new Error('ssh channel closed'))
    const { runtime, repos } = createRuntime([makeRepo({ id: 'ssh-fork', connectionId: 'ssh-1' })])

    runtime.notifySshStateChanged('ssh-1', sshState('ssh-1', 'connected'))
    await drainBackfill()
    expect(repos[0].upstream).toBeUndefined()

    getRepoUpstreamMock.mockResolvedValue(UPSTREAM)
    runtime.notifySshStateChanged('ssh-1', sshState('ssh-1', 'connected'))
    await drainBackfill()

    expect(repos[0].upstream).toEqual(UPSTREAM)
  })

  it('never overlaps probes when several connections come up at once', async () => {
    let inFlight = 0
    let maxInFlight = 0
    getRepoUpstreamMock.mockImplementation(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await Promise.resolve()
      inFlight -= 1
      return null
    })
    const { runtime } = createRuntime([
      makeRepo({ id: 'a', path: '/srv/a', connectionId: 'ssh-1' }),
      makeRepo({ id: 'b', path: '/srv/b', connectionId: 'ssh-2' }),
      makeRepo({ id: 'c', path: '/srv/c', connectionId: 'ssh-3' })
    ])

    runtime.notifySshStateChanged('ssh-1', sshState('ssh-1', 'connected'))
    runtime.notifySshStateChanged('ssh-2', sshState('ssh-2', 'connected'))
    runtime.notifySshStateChanged('ssh-3', sshState('ssh-3', 'connected'))
    await drainBackfill()

    expect(getRepoUpstream).toHaveBeenCalledTimes(3)
    expect(maxInFlight).toBe(1)
  })

  it('returns from the connect notification without waiting on the probe', async () => {
    let resolveProbe: ((value: unknown) => void) | undefined
    getRepoUpstreamMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProbe = resolve
        })
    )
    const { runtime, repos } = createRuntime([makeRepo({ id: 'ssh-fork', connectionId: 'ssh-1' })])

    runtime.notifySshStateChanged('ssh-1', sshState('ssh-1', 'connected'))

    expect(getRepoUpstream).not.toHaveBeenCalled()
    await drainBackfill()
    expect(getRepoUpstream).toHaveBeenCalledOnce()
    expect(repos[0].upstream).toBeUndefined()

    resolveProbe?.(UPSTREAM)
    await drainBackfill()
    expect(repos[0].upstream).toEqual(UPSTREAM)
  })

  it('leaves the startup pass local-only', async () => {
    const { runtime } = createRuntime([
      makeRepo({ id: 'local', path: '/home/a' }),
      makeRepo({ id: 'ssh-fork', connectionId: 'ssh-1' })
    ])

    runtime.setNotifier({ reposChanged: vi.fn() } as never)
    await drainBackfill()

    expect(getRepoUpstream).toHaveBeenCalledExactlyOnceWith('/home/a', null)
  })
})
