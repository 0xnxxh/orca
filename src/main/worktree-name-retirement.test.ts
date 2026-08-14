import { beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MARINE_CREATURES } from '../shared/marine-creatures'
import type { GlobalSettings, Repo } from '../shared/types'
import {
  collectRetiredNamesFromLeafNames,
  discoverRetiredWorktreeNames,
  ensureRetiredWorktreeNamesBackfilled,
  extractBucketLeafCandidates,
  getRetiredWorktreeNamesForRepo,
  normalizeRetirableGeneratedName,
  resetRetirementCollisionKeyCacheForTests,
  retireGeneratedWorktreeName
} from './worktree-name-retirement'

const FIRST = MARINE_CREATURES[0].toLowerCase()
const SECOND = MARINE_CREATURES[1].toLowerCase()

const makeRepo = (id: string, path: string): Repo =>
  ({ id, path, displayName: id, badgeColor: '', addedAt: 0 }) as Repo

beforeEach(() => {
  resetRetirementCollisionKeyCacheForTests()
})

describe('normalizeRetirableGeneratedName', () => {
  it('accepts pool names and every numbered tier, not just single digits', () => {
    expect(normalizeRetirableGeneratedName(` ${FIRST} `)).toBe(FIRST)
    expect(normalizeRetirableGeneratedName(`${FIRST}-2`)).toBe(`${FIRST}-2`)
    // Why: the previous `-([2-9]\d*)` never matched these, so a path whose agent history was
    // still on disk got reissued — the exact bug this module exists to prevent.
    expect(normalizeRetirableGeneratedName(`${FIRST}-10`)).toBe(`${FIRST}-10`)
    expect(normalizeRetirableGeneratedName(`${FIRST}-100`)).toBe(`${FIRST}-100`)
  })

  it('rejects names outside the pool and absurdly long input', () => {
    expect(normalizeRetirableGeneratedName('fix-login')).toBeNull()
    expect(normalizeRetirableGeneratedName('')).toBeNull()
    expect(normalizeRetirableGeneratedName(`${FIRST}-${'9'.repeat(300)}`)).toBeNull()
  })
})

describe('extractBucketLeafCandidates', () => {
  it('takes everything past the encoded parent as the leaf', () => {
    expect(extractBucketLeafCandidates(`-w-orca-${FIRST}`, ['-w-orca'])).toEqual([FIRST])
  })

  it('does not treat the parent directory as a leaf when the workspace name is numeric', () => {
    // Real data: `-Users-x-orca-workspaces-orca-7474` must not retire `orca`, which is in the pool.
    expect(extractBucketLeafCandidates('-w-workspaces-orca-7474', ['-w-workspaces-orca'])).toEqual([
      '7474'
    ])
  })

  it('offers the first segment too, so an agent run in a subdirectory still retires the leaf', () => {
    expect(extractBucketLeafCandidates(`-w-orca-${FIRST}-packages-api`, ['-w-orca'])).toEqual([
      `${FIRST}-packages-api`,
      FIRST
    ])
  })

  it('rejects a sibling directory that shares the parent prefix', () => {
    expect(extractBucketLeafCandidates(`-w-orcadyne-${FIRST}`, ['-w-orca'])).toEqual([])
    expect(extractBucketLeafCandidates(`-w-orca-secret-${FIRST}`, ['-w-orca-fix'])).toEqual([])
  })

  it('yields nothing for the parent bucket itself', () => {
    expect(extractBucketLeafCandidates('-w-orca', ['-w-orca'])).toEqual([])
  })
})

describe('collectRetiredNamesFromLeafNames', () => {
  it('keeps pool names and drops everything else', () => {
    expect(collectRetiredNamesFromLeafNames([FIRST, SECOND, 'fix-login'])).toEqual(
      new Set([FIRST, SECOND])
    )
  })

  it('is case-insensitive and skips non-string entries without throwing', () => {
    const leaves = [undefined, null, '', MARINE_CREATURES[0].toUpperCase()] as unknown as string[]
    expect(collectRetiredNamesFromLeafNames(leaves)).toEqual(new Set([FIRST]))
  })
})

describe('discoverRetiredWorktreeNames', () => {
  /** Buckets are written with the REAL per-character encoding, because a helper that mirrors the
   *  implementation would pass against a broken encoder — which is how the Windows gap shipped. */
  async function withFakeHome(
    buckets: readonly string[],
    run: (home: string) => Promise<void>
  ): Promise<void> {
    const home = await mkdtemp(join(tmpdir(), 'orca-retirement-home-'))
    try {
      for (const bucket of buckets) {
        await mkdir(join(home, '.claude', 'projects', bucket), { recursive: true })
      }
      await run(home)
    } finally {
      await rm(home, { force: true, recursive: true })
    }
  }

  it('matches a plain POSIX workspace root', async () => {
    await withFakeHome([`-Users-ada-orca-workspaces-orca-${FIRST}`], async (home) => {
      const retired = await discoverRetiredWorktreeNames({
        workspaceRoots: ['/Users/ada/orca/workspaces/orca'],
        home,
        env: {}
      })
      expect(retired).toEqual(new Set([FIRST]))
    })
  })

  it('matches a dot-directory root, where the separator run encodes to two dashes', async () => {
    await withFakeHome([`-Users-ada--orca-worktrees-${FIRST}`], async (home) => {
      const retired = await discoverRetiredWorktreeNames({
        workspaceRoots: ['/Users/ada/.orca/worktrees'],
        home,
        env: {}
      })
      expect(retired).toEqual(new Set([FIRST]))
    })
  })

  it('matches a Windows drive root', async () => {
    // `getDefaultWorkspaceDir` returns `C:\Users\<user>\orca\workspaces` on Windows, so an encoder
    // that collapsed `:\` rejected every bucket on that platform by default.
    await withFakeHome([`C--Users-ada-orca-workspaces-${FIRST}`], async (home) => {
      const retired = await discoverRetiredWorktreeNames({
        workspaceRoots: ['C:\\Users\\ada\\orca\\workspaces'],
        home,
        env: {}
      })
      expect(retired).toEqual(new Set([FIRST]))
    })
  })

  it('matches a WSL UNC root', async () => {
    await withFakeHome([`--wsl--Ubuntu-home-ada-orca-workspaces-${FIRST}`], async (home) => {
      const retired = await discoverRetiredWorktreeNames({
        workspaceRoots: ['\\\\wsl$\\Ubuntu\\home\\ada\\orca\\workspaces'],
        home,
        env: {}
      })
      expect(retired).toEqual(new Set([FIRST]))
    })
  })

  it('ignores buckets belonging to a sibling root with the same prefix', async () => {
    await withFakeHome(
      [`-Users-ada-orca-workspaces-orcadyne-${FIRST}`, `-Users-ada-orca-workspaces-orca-${SECOND}`],
      async (home) => {
        const retired = await discoverRetiredWorktreeNames({
          workspaceRoots: ['/Users/ada/orca/workspaces/orca'],
          home,
          env: {}
        })
        expect(retired).toEqual(new Set([SECOND]))
      }
    )
  })

  it('reads buckets from CLAUDE_CONFIG_DIR when it is set', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'orca-retirement-config-'))
    await withFakeHome([`-Users-ada-w-${SECOND}`], async (home) => {
      try {
        await mkdir(join(configDir, 'projects', `-Users-ada-w-${FIRST}`), { recursive: true })
        const retired = await discoverRetiredWorktreeNames({
          workspaceRoots: ['/Users/ada/w'],
          home,
          env: { CLAUDE_CONFIG_DIR: configDir }
        })
        // The override relocates the whole state root, so the default home is not also scanned.
        expect(retired).toEqual(new Set([FIRST]))
      } finally {
        await rm(configDir, { force: true, recursive: true })
      }
    })
  })

  it('retires live workspace directories alongside surviving buckets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-retirement-roots-'))
    await withFakeHome([], async (home) => {
      try {
        await mkdir(join(root, SECOND), { recursive: true })
        const retired = await discoverRetiredWorktreeNames({
          workspaceRoots: [root],
          home,
          env: {}
        })
        expect(retired).toEqual(new Set([SECOND]))
      } finally {
        await rm(root, { force: true, recursive: true })
      }
    })
  })
})

describe('getRetiredWorktreeNamesForRepo', () => {
  const settingsFor = (nestWorkspaces: boolean): GlobalSettings =>
    ({ workspaceDir: '/workspaces', nestWorkspaces }) as GlobalSettings

  it('shares retirements when two repos create into the same cwd namespace', () => {
    const byKey = new Map<string, string[]>()
    const store = {
      getRetiredWorktreeNames: (key: string) => byKey.get(key) ?? [],
      addRetiredWorktreeName: (key: string, name: string) =>
        byKey.set(key, [...(byKey.get(key) ?? []), name])
    }
    const settings = settingsFor(false)
    const repoA = makeRepo('repo-a', '/repos/a')
    const repoB = makeRepo('repo-b', '/repos/b')

    retireGeneratedWorktreeName(store, repoA, settings, FIRST)

    expect(getRetiredWorktreeNamesForRepo(store, repoB, settings)).toEqual([FIRST])
  })

  it('keeps independent nested repo paths in separate retirement domains', () => {
    const byKey = new Map<string, string[]>()
    const store = {
      getRetiredWorktreeNames: (key: string) => byKey.get(key) ?? [],
      addRetiredWorktreeName: (key: string, name: string) =>
        byKey.set(key, [...(byKey.get(key) ?? []), name])
    }
    const settings = settingsFor(true)
    const repoA = makeRepo('repo-a', '/repos/a')
    const repoB = makeRepo('repo-b', '/repos/b')

    retireGeneratedWorktreeName(store, repoA, settings, FIRST)

    expect(getRetiredWorktreeNamesForRepo(store, repoB, settings)).toEqual([])
    expect(getRetiredWorktreeNamesForRepo(store, repoA, settings)).toEqual([FIRST])
  })

  it('survives a repo being removed and re-added under a new id', () => {
    // Why: repo ids are regenerated on re-add. Keying the registry by repo id silently dropped
    // every retirement for a path that had not changed at all.
    const byKey = new Map<string, string[]>()
    const store = {
      getRetiredWorktreeNames: (key: string) => byKey.get(key) ?? [],
      addRetiredWorktreeName: (key: string, name: string) =>
        byKey.set(key, [...(byKey.get(key) ?? []), name])
    }
    const settings = settingsFor(true)

    retireGeneratedWorktreeName(store, makeRepo('repo-old', '/repos/a'), settings, FIRST)

    expect(
      getRetiredWorktreeNamesForRepo(store, makeRepo('repo-new', '/repos/a'), settings)
    ).toEqual([FIRST])
  })

  it('reports nothing for a folder workspace, which has no generated worktree names', () => {
    const store = { getRetiredWorktreeNames: () => [FIRST] }
    const folderRepo = { ...makeRepo('folder', '/repos/folder'), kind: 'folder' as const }
    expect(getRetiredWorktreeNamesForRepo(store, folderRepo, settingsFor(false))).toEqual([])
  })
})

describe('ensureRetiredWorktreeNamesBackfilled', () => {
  it('awaits the historical workspace scan before returning names to a client', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-retirement-backfill-'))
    const workspaceRoot = join(root, 'workspaces')
    await mkdir(join(workspaceRoot, FIRST), { recursive: true })
    const merged: { key: string; names: string[] }[] = []
    const store = {
      mergeRetiredWorktreeNames: (key: string, names: Iterable<string>) => {
        merged.push({ key, names: [...names] })
        return true
      }
    }
    const repo = makeRepo('repo-a', join(root, 'repos', 'a'))
    const settings = { workspaceDir: workspaceRoot, nestWorkspaces: false }

    try {
      await ensureRetiredWorktreeNamesBackfilled(store, repo, settings)
      expect(merged).toHaveLength(1)
      expect(merged[0].names).toContain(FIRST)

      // A second repo in the same namespace reuses the one in-flight scan.
      await ensureRetiredWorktreeNamesBackfilled(store, makeRepo('repo-b', '/repos/b'), settings)
      expect(merged).toHaveLength(1)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('skips repos whose agent state lives on another host', async () => {
    const merged: string[] = []
    const store = {
      mergeRetiredWorktreeNames: (_key: string, names: Iterable<string>) => {
        merged.push(...names)
        return true
      }
    }
    const sshRepo = { ...makeRepo('repo-ssh', '/remote/repo'), connectionId: 'ssh-1' }

    await ensureRetiredWorktreeNamesBackfilled(store, sshRepo, {
      workspaceDir: '/workspaces',
      nestWorkspaces: false
    })

    expect(merged).toEqual([])
  })
})
