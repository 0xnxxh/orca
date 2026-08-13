import { describe, expect, it } from 'vitest'
import type { Repo, WorktreeVisibilityDefaults } from '../../../../shared/types'
import { hasGloballyShownWorktreeVisibilitySource } from './worktree-visibility-source-provenance'

function repo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/repo',
    displayName: 'orca',
    badgeColor: '#000000',
    addedAt: 0,
    externalWorktreeVisibility: undefined,
    ...overrides
  }
}

describe('hasGloballyShownWorktreeVisibilitySource', () => {
  const shownClaude: WorktreeVisibilityDefaults = {
    external: 'hide',
    sourcePreferences: { builtIn: { claude: 'show' } }
  }

  it('detects an inherited source enabled in global settings', () => {
    expect(hasGloballyShownWorktreeVisibilitySource(repo(), shownClaude)).toBe(true)
  })

  it('ignores a globally enabled source overridden by the project', () => {
    expect(
      hasGloballyShownWorktreeVisibilitySource(
        repo({ worktreeVisibilitySourcePreferences: { builtIn: { claude: 'hide' } } }),
        shownClaude
      )
    ).toBe(false)
  })

  it('ignores global settings when all inherited sources are hidden', () => {
    expect(hasGloballyShownWorktreeVisibilitySource(repo(), { external: 'hide' })).toBe(false)
  })

  it('detects an inherited custom source enabled in global settings', () => {
    expect(
      hasGloballyShownWorktreeVisibilitySource(repo(), {
        external: 'hide',
        customSources: [{ id: 'team', rootPath: '/srv/team' }],
        sourcePreferences: { custom: { team: 'show' } }
      })
    ).toBe(true)
  })
})
