import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  ghExecFileAsyncMock,
  getOwnerRepoMock,
  getWorkItemMock,
  getPRChecksMock,
  getPRCommentsMock
} = vi.hoisted(() => ({
  ghExecFileAsyncMock: vi.fn(),
  getOwnerRepoMock: vi.fn(),
  getWorkItemMock: vi.fn(),
  getPRChecksMock: vi.fn(),
  getPRCommentsMock: vi.fn()
}))

vi.mock('./gh-utils', () => ({
  ghExecFileAsync: ghExecFileAsyncMock,
  getOwnerRepo: getOwnerRepoMock,
  getIssueOwnerRepo: vi.fn(),
  ghRepoExecOptions: vi.fn((context) => ({ cwd: context.repoPath })),
  githubRepoContext: vi.fn((repoPath, connectionId, localGitOptions) => ({
    repoPath,
    connectionId: connectionId ?? null,
    ...localGitOptions
  })),
  acquire: vi.fn(),
  release: vi.fn()
}))

vi.mock('./client', () => ({
  getWorkItem: getWorkItemMock,
  getWorkItemByOwnerRepo: vi.fn(),
  getPRChecks: getPRChecksMock,
  getPRComments: getPRCommentsMock
}))

vi.mock('./github-enterprise-repository', () => ({
  getEnterpriseGitHubRepoSlug: vi.fn().mockResolvedValue(null)
}))

vi.mock('./rate-limit', () => ({
  rateLimitGuard: vi.fn(() => ({ blocked: false })),
  noteRateLimitSpend: vi.fn(),
  repositoryRateLimitGuard: vi.fn(() => ({ blocked: false })),
  noteRepositoryRateLimitSpend: vi.fn()
}))

import { getWorkItemDetails } from './work-item-details'

function pullRequestItem(number: number, title: string): Record<string, unknown> {
  return {
    id: `pr:${number}`,
    type: 'pr',
    number,
    title,
    state: 'open',
    url: `https://github.com/acme/widgets/pull/${number}`,
    labels: [],
    updatedAt: '2026-07-16T00:00:00Z',
    author: 'pr-author'
  }
}

function auxiliaryPRResponse(args: string[]): { stdout: string } {
  const query = args.find((arg) => arg.startsWith('query=')) ?? ''
  if (query.includes('viewerViewedState')) {
    return {
      stdout: JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              id: 'PR_file_list',
              files: { pageInfo: { hasNextPage: false }, nodes: [] }
            }
          }
        }
      })
    }
  }
  if (query.includes('participants(first: 100)')) {
    return {
      stdout: JSON.stringify({
        data: { repository: { pullRequest: { participants: { nodes: [] } } } }
      })
    }
  }
  return { stdout: JSON.stringify({ data: {} }) }
}

describe('getWorkItemDetails PR file listing', () => {
  beforeEach(() => {
    ghExecFileAsyncMock.mockReset()
    getOwnerRepoMock.mockReset()
    getOwnerRepoMock.mockResolvedValue({ owner: 'acme', repo: 'widgets' })
    getWorkItemMock.mockReset()
    getPRChecksMock.mockReset()
    getPRChecksMock.mockResolvedValue([])
    getPRCommentsMock.mockReset()
    getPRCommentsMock.mockResolvedValue([])
  })

  it('loads files beyond the first 100-result REST page', async () => {
    getWorkItemMock.mockResolvedValueOnce(pullRequestItem(108, 'Large PR'))
    const restFile = (index: number) => ({
      filename: `src/file-${index}.ts`,
      status: 'modified',
      additions: 1,
      deletions: 0,
      changes: 1,
      patch: '@@ -1 +1 @@'
    })
    ghExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      const endpoint = args.find((arg) => arg.startsWith('repos/')) ?? ''
      if (endpoint === 'repos/acme/widgets/pulls/108') {
        return { stdout: JSON.stringify({ head: { sha: 'head' }, base: { sha: 'base' } }) }
      }
      if (endpoint === 'repos/acme/widgets/pulls/108/files?per_page=100') {
        return {
          stdout: JSON.stringify(Array.from({ length: 100 }, (_, index) => restFile(index)))
        }
      }
      if (endpoint === 'repos/acme/widgets/pulls/108/files?per_page=100&page=2') {
        return { stdout: JSON.stringify([restFile(100)]) }
      }
      return auxiliaryPRResponse(args)
    })

    const details = await getWorkItemDetails('/repo-root', 108, 'pr')

    expect(details?.files).toHaveLength(101)
    expect(details?.files?.at(-1)?.path).toBe('src/file-100.ts')
    const fileEndpoints = ghExecFileAsyncMock.mock.calls
      .map(([args]) => (args as string[]).find((arg) => arg.includes('/files?')))
      .filter(Boolean)
    expect(fileEndpoints).toEqual([
      'repos/acme/widgets/pulls/108/files?per_page=100',
      'repos/acme/widgets/pulls/108/files?per_page=100&page=2'
    ])
  })

  // Why: a rate-limited/auth-failed file fetch must not render as an empty PR;
  // the Files tab keys its retry state off details.filesUnavailable.
  it('flags filesUnavailable when the file fetch fails', async () => {
    getWorkItemMock.mockResolvedValueOnce(pullRequestItem(8305, 'Files fetch fails'))
    ghExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      const target = args.at(-1)
      if (target === 'repos/acme/widgets/pulls/8305') {
        return {
          stdout: JSON.stringify({ head: { sha: 'head-sha' }, base: { sha: 'base-sha' } })
        }
      }
      if (target === 'repos/acme/widgets/pulls/8305/files?per_page=100') {
        throw new Error('gh: API rate limit exceeded (403)')
      }
      return auxiliaryPRResponse(args)
    })

    const details = await getWorkItemDetails('/repo-root', 8305, 'pr')

    expect(details?.filesUnavailable).toBe(true)
    expect(details?.files).toBeUndefined()
  })

  it('preserves an empty file list as an available result', async () => {
    getWorkItemMock.mockResolvedValueOnce(pullRequestItem(8306, 'Empty PR'))
    ghExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      const target = args.at(-1)
      if (target === 'repos/acme/widgets/pulls/8306') {
        return {
          stdout: JSON.stringify({ head: { sha: 'head-sha' }, base: { sha: 'base-sha' } })
        }
      }
      if (target === 'repos/acme/widgets/pulls/8306/files?per_page=100') {
        return { stdout: '[]' }
      }
      return auxiliaryPRResponse(args)
    })

    const details = await getWorkItemDetails('/repo-root', 8306, 'pr')

    expect(details?.filesUnavailable).toBe(false)
    expect(details?.files).toEqual([])
  })
})
