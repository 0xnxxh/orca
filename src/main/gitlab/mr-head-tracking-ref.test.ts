import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshGitProvider } from '../providers/ssh-git-provider'

const { gitExecFileAsyncMock } = vi.hoisted(() => ({ gitExecFileAsyncMock: vi.fn() }))
vi.mock('../git/runner', () => ({ gitExecFileAsync: gitExecFileAsyncMock }))

import {
  gitlabMergeRequestHeadLocalRef,
  REVIEW_HEAD_FETCH_TIMEOUT_MS
} from '../../shared/review-head-tracking-ref'
import { fetchGitLabMergeRequestHeadRef } from './mr-head-tracking-ref'

describe('fetchGitLabMergeRequestHeadRef', () => {
  beforeEach(() => {
    gitExecFileAsyncMock.mockReset()
    gitExecFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' })
  })

  it('fetches a GitLab MR head into its Orca ref for local repos', async () => {
    await fetchGitLabMergeRequestHeadRef({ path: '/repo', connectionId: null }, null, 'origin', 42)

    // The fetch is bounded so a stalled remote can't hang MR resolution.
    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      ['fetch', '--no-tags', 'origin', '+refs/merge-requests/42/head:refs/orca/merge-requests/42'],
      { cwd: '/repo', timeout: REVIEW_HEAD_FETCH_TIMEOUT_MS }
    )
    expect(gitlabMergeRequestHeadLocalRef(42)).toBe('refs/orca/merge-requests/42')
  })

  it('keeps WSL routing while bounding the MR-head fetch', async () => {
    await fetchGitLabMergeRequestHeadRef(
      { path: '/repo', connectionId: null },
      null,
      'origin',
      42,
      {
        localGitExecOptions: { cwd: '/repo', wslDistro: 'Ubuntu' }
      }
    )

    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      ['fetch', '--no-tags', 'origin', '+refs/merge-requests/42/head:refs/orca/merge-requests/42'],
      { cwd: '/repo', wslDistro: 'Ubuntu', timeout: REVIEW_HEAD_FETCH_TIMEOUT_MS }
    )
  })

  it('uses the SSH GitLab MR-head RPC and never runs git directly', async () => {
    const fetchGitLabMergeRequestHead = vi.fn(async () => {})

    await fetchGitLabMergeRequestHeadRef(
      { path: '/repo', connectionId: 'conn-1' },
      { fetchGitLabMergeRequestHead } as unknown as SshGitProvider,
      'origin',
      77
    )

    expect(fetchGitLabMergeRequestHead).toHaveBeenCalledWith('/repo', 'origin', 77)
    expect(gitExecFileAsyncMock).not.toHaveBeenCalled()
  })

  it('rejects a connected GitLab MR-head fetch without an SSH provider', async () => {
    await expect(
      fetchGitLabMergeRequestHeadRef({ path: '/repo', connectionId: 'conn-1' }, null, 'origin', 77)
    ).rejects.toThrow('SSH Git provider is not available')
    expect(gitExecFileAsyncMock).not.toHaveBeenCalled()
  })

  it('rejects invalid MR iids and option-shaped remotes before running git', async () => {
    await expect(
      fetchGitLabMergeRequestHeadRef({ path: '/repo', connectionId: null }, null, 'origin', 0)
    ).rejects.toThrow('Invalid merge request iid')
    await expect(
      fetchGitLabMergeRequestHeadRef(
        { path: '/repo', connectionId: null },
        null,
        '--upload-pack=x',
        42
      )
    ).rejects.toThrow('must not start with "-"')
    expect(gitExecFileAsyncMock).not.toHaveBeenCalled()
  })
})
