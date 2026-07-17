import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as GitHubEnterpriseRepository from './github-enterprise-repository'

const { isGitHubHostAuthenticatedMock } = vi.hoisted(() => ({
  isGitHubHostAuthenticatedMock: vi.fn()
}))

vi.mock('./github-enterprise-repository', async (importOriginal) => ({
  ...(await importOriginal<typeof GitHubEnterpriseRepository>()),
  isGitHubHostAuthenticated: isGitHubHostAuthenticatedMock
}))

import {
  githubHostExecOptions,
  resolveGitHubApiRepository,
  resolveGitHubRepoExecution
} from './github-api-repository'

beforeEach(() => {
  isGitHubHostAuthenticatedMock.mockReset().mockResolvedValue(false)
})

describe('githubHostExecOptions', () => {
  it('pins every known repository host', () => {
    expect(githubHostExecOptions({ owner: 'acme', repo: 'widgets', host: 'github.com' })).toEqual({
      host: 'github.com'
    })
    expect(
      githubHostExecOptions({ owner: 'acme', repo: 'widgets', host: 'github.acme-corp.com' })
    ).toEqual({ host: 'github.acme-corp.com' })
  })

  it('does not invent a host when repository identity is unavailable or legacy', () => {
    expect(githubHostExecOptions({ owner: 'acme', repo: 'widgets' })).toEqual({})
    expect(githubHostExecOptions(null)).toEqual({})
  })
})

describe('resolveGitHubRepoExecution', () => {
  it('combines local repository and GitHub host execution options', async () => {
    const ownerRepo = { owner: 'acme', repo: 'widgets', host: 'github.acme-corp.com' }
    isGitHubHostAuthenticatedMock.mockResolvedValue(true)

    await expect(
      resolveGitHubRepoExecution('/repo', ownerRepo, null, { wslDistro: 'Ubuntu' })
    ).resolves.toEqual({
      ownerRepo,
      ghOptions: {
        cwd: '/repo',
        wslDistro: 'Ubuntu',
        host: 'github.acme-corp.com'
      }
    })
    expect(isGitHubHostAuthenticatedMock).toHaveBeenCalledWith(
      'github.acme-corp.com',
      '/repo',
      null,
      { wslDistro: 'Ubuntu' }
    )
  })

  it('rejects an explicit Enterprise host absent from the local gh auth inventory', async () => {
    await expect(
      resolveGitHubApiRepository(
        '/remote/repo',
        {
          owner: 'acme',
          repo: 'widgets',
          host: 'evil.example.test'
        },
        'ssh-1'
      )
    ).resolves.toBeNull()

    expect(isGitHubHostAuthenticatedMock).toHaveBeenCalledWith(
      'evil.example.test',
      '/remote/repo',
      'ssh-1',
      {}
    )
  })

  it('normalizes github.com without spending an auth inventory probe', async () => {
    await expect(
      resolveGitHubApiRepository('/repo', {
        owner: 'acme',
        repo: 'widgets',
        host: ' GitHub.COM '
      })
    ).resolves.toEqual({ owner: 'acme', repo: 'widgets', host: 'github.com' })

    expect(isGitHubHostAuthenticatedMock).not.toHaveBeenCalled()
  })

  it('uses a caller-specific repository resolver without changing its identity', async () => {
    const ownerRepo = { owner: 'upstream', repo: 'widgets' }

    await expect(
      resolveGitHubRepoExecution('/remote/repo', async () => ownerRepo, 'ssh-1')
    ).resolves.toEqual({
      ownerRepo,
      ghOptions: {}
    })
  })
})
