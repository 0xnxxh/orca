import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSshGitProviderMock, getSshGitProviderGenerationMock, gitExecFileAsyncMock } = vi.hoisted(
  () => ({
    getSshGitProviderMock: vi.fn(),
    getSshGitProviderGenerationMock: vi.fn(() => 0),
    gitExecFileAsyncMock: vi.fn()
  })
)

vi.mock('../providers/ssh-git-dispatch', () => ({
  getSshGitProvider: getSshGitProviderMock,
  getSshGitProviderGeneration: getSshGitProviderGenerationMock,
  SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE: 'SSH Git provider unavailable'
}))

vi.mock('./runner', () => ({ gitExecFileAsync: gitExecFileAsyncMock }))

import { createRemoteRefProbeCache } from './remote-ref-probe-cache'

const NEGATIVE_ENTRY_TTL_MS = 5 * 60_000

/** Stands in for a forge's parser: claims one host, rejects everything else. */
function parseExampleRef(remoteUrl: string): { repo: string } | null {
  const match = remoteUrl.trim().match(/^git@example\.com:(.+?)(?:\.git)?$/)
  return match ? { repo: match[1] } : null
}

describe('remote ref probe cache (P1-D)', () => {
  beforeEach(() => {
    getSshGitProviderMock.mockReset()
    getSshGitProviderGenerationMock.mockReset()
    getSshGitProviderGenerationMock.mockReturnValue(0)
    gitExecFileAsyncMock.mockReset()
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('answers concurrent lookups for one repo with a single probe', async () => {
    const cache = createRemoteRefProbeCache(parseExampleRef)
    gitExecFileAsyncMock.mockResolvedValue({ stdout: 'git@example.com:team/repo.git\n' })

    const answers = await Promise.all([
      cache.get('/repo', 'origin'),
      cache.get('/repo', 'origin'),
      cache.get('/repo', 'origin')
    ])

    expect(answers).toEqual([{ repo: 'team/repo' }, { repo: 'team/repo' }, { repo: 'team/repo' }])
    expect(gitExecFileAsyncMock).toHaveBeenCalledTimes(1)
  })

  it('re-probes a repo whose remotes could have changed since the miss', async () => {
    const cache = createRemoteRefProbeCache(parseExampleRef)
    gitExecFileAsyncMock.mockRejectedValueOnce(new Error("fatal: No such remote 'origin'"))

    await expect(cache.get('/repo', 'origin')).resolves.toBeNull()
    await expect(cache.get('/repo', 'origin')).resolves.toBeNull()
    expect(gitExecFileAsyncMock).toHaveBeenCalledTimes(1)

    // A remote added after the miss is only visible once the negative expires;
    // nothing here watches .git/config, and SSH/WSL repos have no file to watch.
    gitExecFileAsyncMock.mockResolvedValue({ stdout: 'git@example.com:team/repo.git\n' })
    vi.setSystemTime(1_000_000 + NEGATIVE_ENTRY_TTL_MS + 1)

    await expect(cache.get('/repo', 'origin')).resolves.toEqual({ repo: 'team/repo' })
    expect(gitExecFileAsyncMock).toHaveBeenCalledTimes(2)
  })

  it('keeps a resolved ref without re-probing', async () => {
    const cache = createRemoteRefProbeCache(parseExampleRef)
    gitExecFileAsyncMock.mockResolvedValue({ stdout: 'git@example.com:team/repo.git\n' })

    await expect(cache.get('/repo', 'origin')).resolves.toEqual({ repo: 'team/repo' })
    vi.setSystemTime(1_000_000 + NEGATIVE_ENTRY_TTL_MS * 10)
    await expect(cache.get('/repo', 'origin')).resolves.toEqual({ repo: 'team/repo' })

    expect(gitExecFileAsyncMock).toHaveBeenCalledTimes(1)
  })

  it('does not let a lookup on a reconnected provider join the old connection probe', async () => {
    const cache = createRemoteRefProbeCache(parseExampleRef)
    let releaseStalled = (): void => {}
    const execMock = vi
      .fn()
      .mockImplementationOnce(
        async () => await new Promise((resolve) => (releaseStalled = () => resolve({ stdout: '' })))
      )
      .mockResolvedValue({ stdout: 'git@example.com:team/repo.git\n' })
    getSshGitProviderMock.mockReturnValue({ exec: execMock })

    const stalled = cache.get('/repo', 'origin', 'conn-1')
    getSshGitProviderGenerationMock.mockReturnValue(1)

    await expect(cache.get('/repo', 'origin', 'conn-1')).resolves.toEqual({ repo: 'team/repo' })
    expect(execMock).toHaveBeenCalledTimes(2)

    releaseStalled()
    await expect(stalled).resolves.toBeNull()
  })

  it('does not cache a probe killed on its deadline as a definitive miss', async () => {
    const cache = createRemoteRefProbeCache(parseExampleRef)
    gitExecFileAsyncMock
      .mockRejectedValueOnce(new Error('git timed out.'))
      .mockResolvedValueOnce({ stdout: 'git@example.com:team/repo.git\n' })

    await expect(cache.get('/repo', 'origin')).resolves.toBeNull()
    await expect(cache.get('/repo', 'origin')).resolves.toEqual({ repo: 'team/repo' })
    expect(gitExecFileAsyncMock).toHaveBeenCalledTimes(2)
  })
})
