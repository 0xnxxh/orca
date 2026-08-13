import { describe, expect, it } from 'vitest'
import type { Repo } from './types'
import {
  buildWorktreeSourcePreferenceUpdate,
  createWorktreeVisibilitySourceMatcher,
  effectiveBuiltInWorktreeSourceVisibility,
  normalizeCustomWorktreeVisibilitySources,
  normalizeWorktreeVisibilitySourcePreferences
} from './worktree-visibility-sources'

function repo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/repo',
    displayName: 'repo',
    addedAt: 1,
    ...overrides,
    badgeColor: overrides.badgeColor ?? '#fff'
  }
}

describe('worktree visibility sources', () => {
  it('classifies each built-in independently across linked checkouts', () => {
    const classify = createWorktreeVisibilitySourceMatcher(['/repo', '/worktrees/feature'])
    expect(classify('/repo/.claude/worktrees/review')).toEqual({
      kind: 'built-in',
      id: 'claude'
    })
    expect(classify('/worktrees/feature/.gsd-workspaces/phase-1')).toEqual({
      kind: 'built-in',
      id: 'gsd'
    })
    expect(classify('/other/.claude/worktrees/review')).toBeNull()
  })

  it('matches custom descendants with Windows and WSL comparison semantics', () => {
    const windows = createWorktreeVisibilitySourceMatcher(
      [],
      [{ id: 'team', rootPath: 'C:\\Users\\Dev\\Team' }]
    )
    expect(windows('c:\\users\\dev\\team\\feature')).toEqual({
      kind: 'custom',
      id: 'team'
    })

    const wsl = createWorktreeVisibilitySourceMatcher(
      [],
      [{ id: 'linux', rootPath: '//wsl$/Ubuntu/home/dev/team' }]
    )
    expect(wsl('//wsl.localhost/Ubuntu/home/dev/team/feature')).toEqual({
      kind: 'custom',
      id: 'linux'
    })
    expect(wsl('//wsl.localhost/Ubuntu/home/Dev/team/feature')).toBeNull()
  })

  it('gives built-ins precedence over overlapping custom roots', () => {
    const classify = createWorktreeVisibilitySourceMatcher(
      ['/repo'],
      [{ id: 'overlap', rootPath: '/repo/.claude/worktrees' }]
    )
    expect(classify('/repo/.claude/worktrees/review')).toEqual({
      kind: 'built-in',
      id: 'claude'
    })
  })

  it('migrates the optional legacy agent policy lazily for both built-ins', () => {
    const legacy = repo({ agentWorktreeVisibility: 'show' })
    expect(effectiveBuiltInWorktreeSourceVisibility(legacy, 'claude')).toBe('show')
    expect(effectiveBuiltInWorktreeSourceVisibility(legacy, 'gsd')).toBe('show')
    expect(
      buildWorktreeSourcePreferenceUpdate(legacy, { kind: 'built-in', id: 'claude' }, 'hide')
    ).toEqual({ builtIn: { claude: 'hide', gsd: 'show' } })
  })

  it('bounds and sanitizes persisted source definitions and preferences', () => {
    expect(
      normalizeCustomWorktreeVisibilitySources([
        { id: 'team', rootPath: ' /srv/team/ ' },
        { id: 'duplicate-root', rootPath: '/srv/team' },
        { id: 'relative', rootPath: '../team' },
        { id: 'bad id', rootPath: '/srv/other' }
      ])
    ).toEqual([{ id: 'team', rootPath: '/srv/team/' }])
    expect(
      normalizeWorktreeVisibilitySourcePreferences({
        builtIn: { claude: 'show', gsd: 'invalid', unknown: 'show' },
        custom: { team: 'hide', nope: 'invalid' }
      })
    ).toEqual({ builtIn: { claude: 'show' }, custom: { team: 'hide' } })
  })
})
