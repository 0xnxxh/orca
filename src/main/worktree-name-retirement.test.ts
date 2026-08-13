import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MARINE_CREATURES } from '../shared/marine-creatures'
import type { GlobalSettings, Repo } from '../shared/types'
import {
  collectRetiredNamesFromPaths,
  ensureRetiredWorktreeNamesBackfilled,
  extractCandidateLeafNames,
  getRetiredWorktreeNamesForRepo,
  normalizeRetirableGeneratedName
} from './worktree-name-retirement'

const FIRST = MARINE_CREATURES[0].toLowerCase()
const SECOND = MARINE_CREATURES[1].toLowerCase()

describe('extractCandidateLeafNames', () => {
  it('takes the trailing segment of a real path', () => {
    expect(extractCandidateLeafNames(`/Users/ada/orca/workspaces/orca/${FIRST}`)).toEqual([FIRST])
  })

  it('takes the trailing segment of a dash-encoded transcript bucket', () => {
    expect(extractCandidateLeafNames(`-Users-ada-orca-workspaces-orca-${FIRST}`)).toEqual([FIRST])
  })

  it('keeps a numeric tail attached so suffixed variants retire as themselves', () => {
    // Why: returning only the base would retire "gar" and leave "gar-2" issuable.
    expect(extractCandidateLeafNames(`-Users-ada-worktrees-${FIRST}-2`)).toEqual([
      `${FIRST}-2`,
      FIRST
    ])
  })

  it('handles Windows separators and trailing separators', () => {
    expect(extractCandidateLeafNames(`C:\\worktrees\\${FIRST}\\`)).toEqual([FIRST])
  })

  it('returns nothing for an empty or separator-only input', () => {
    expect(extractCandidateLeafNames('')).toEqual([])
    expect(extractCandidateLeafNames('---')).toEqual([])
  })
})

describe('collectRetiredNamesFromPaths', () => {
  it('retires pool names found in live workspace directories', () => {
    expect(collectRetiredNamesFromPaths([FIRST, SECOND])).toEqual(new Set([FIRST, SECOND]))
  })

  it('retires a name whose directory is gone but whose transcript bucket survives', () => {
    // The core case: this is the evidence that a deleted workspace left agent state behind.
    expect(collectRetiredNamesFromPaths([`-Users-ada-orca-workspaces-orca-${FIRST}`])).toEqual(
      new Set([FIRST])
    )
  })

  it('retires a suffixed variant without also freeing it', () => {
    const retired = collectRetiredNamesFromPaths([`-Users-ada-worktrees-${FIRST}-2`])
    expect(retired.has(`${FIRST}-2`)).toBe(true)
  })

  it('ignores paths that contain no pool name', () => {
    expect(
      collectRetiredNamesFromPaths(['-Users-ada-orca-workspaces-orca-fix-login-redirect'])
    ).toEqual(new Set())
  })

  it('is case-insensitive', () => {
    expect(collectRetiredNamesFromPaths([MARINE_CREATURES[0].toUpperCase()])).toEqual(
      new Set([FIRST])
    )
  })

  it('skips non-string and empty entries without throwing', () => {
    const paths = [undefined, null, '', FIRST] as unknown as string[]
    expect(collectRetiredNamesFromPaths(paths)).toEqual(new Set([FIRST]))
  })
})

describe('normalizeRetirableGeneratedName', () => {
  it('accepts only generated pool names and their numbered variants', () => {
    expect(normalizeRetirableGeneratedName(` ${FIRST} `)).toBe(FIRST)
    expect(normalizeRetirableGeneratedName(`${FIRST}-2`)).toBe(`${FIRST}-2`)
    expect(normalizeRetirableGeneratedName('fix-login')).toBeNull()
    expect(normalizeRetirableGeneratedName(`${FIRST}-1`)).toBeNull()
  })
})

describe('getRetiredWorktreeNamesForRepo', () => {
  const makeRepo = (id: string, path: string): Repo =>
    ({ id, path, displayName: id, badgeColor: '', addedAt: 0 }) as Repo
  const store = {
    getRetiredWorktreeNames: (repoId: string) => (repoId === 'repo-a' ? [FIRST] : [SECOND])
  }

  it('shares retirements when non-nested repos create into the same cwd namespace', () => {
    const repos = [makeRepo('repo-a', '/repos/a'), makeRepo('repo-b', '/repos/b')]
    const settings = { workspaceDir: '/workspaces', nestWorkspaces: false } as GlobalSettings
    expect(getRetiredWorktreeNamesForRepo(store, repos[1], repos, settings).sort()).toEqual(
      [FIRST, SECOND].sort()
    )
  })

  it('keeps independent nested repo paths in separate retirement domains', () => {
    const repos = [makeRepo('repo-a', '/repos/a'), makeRepo('repo-b', '/repos/b')]
    const settings = { workspaceDir: '/workspaces', nestWorkspaces: true } as GlobalSettings
    expect(getRetiredWorktreeNamesForRepo(store, repos[1], repos, settings)).toEqual([SECOND])
  })
})

describe('ensureRetiredWorktreeNamesBackfilled', () => {
  it('awaits the historical workspace scan before returning names to a client', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-retirement-backfill-'))
    const workspaceRoot = join(root, 'workspaces')
    await mkdir(join(workspaceRoot, FIRST), { recursive: true })
    const merged: string[] = []
    const store = {
      mergeRetiredWorktreeNames: (_repoId: string, names: Iterable<string>) => {
        merged.push(...names)
        return true
      }
    }
    const repo = {
      id: 'repo-a',
      path: join(root, 'repos', 'a'),
      displayName: 'repo-a',
      badgeColor: '',
      addedAt: 0
    } as Repo

    try {
      await ensureRetiredWorktreeNamesBackfilled(store, repo, {
        workspaceDir: workspaceRoot,
        nestWorkspaces: false
      })
      expect(merged).toContain(FIRST)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
