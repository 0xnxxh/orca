import { describe, expect, it } from 'vitest'

import { githubHostExecOptions, resolveGitHubRepoExecution } from './github-api-repository'

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
