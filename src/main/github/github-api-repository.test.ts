import { describe, expect, it } from 'vitest'

import { githubHostExecOptions } from './github-api-repository'

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
