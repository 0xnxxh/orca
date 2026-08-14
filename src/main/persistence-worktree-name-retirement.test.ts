import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDefaultPersistedState } from '../shared/constants'
import { MARINE_CREATURES } from '../shared/marine-creatures'

const testState = { dir: '' }

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('./telemetry/client', () => ({ track: vi.fn() }))
vi.mock('./telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

const REPO = 'repo-1'
const OTHER_REPO = 'repo-2'

async function createStore(persisted: Record<string, unknown> = {}) {
  mkdirSync(testState.dir, { recursive: true })
  writeFileSync(
    join(testState.dir, 'orca-data.json'),
    JSON.stringify({ ...getDefaultPersistedState(testState.dir), ...persisted }),
    'utf-8'
  )
  vi.resetModules()
  const { Store, initDataPath } = await import('./persistence')
  initDataPath()
  return new Store()
}

beforeEach(() => {
  testState.dir = mkdtempSync(join(tmpdir(), 'orca-worktree-name-retirement-'))
})

afterEach(() => {
  rmSync(testState.dir, { force: true, recursive: true })
})

describe('worktree name retirement registry', () => {
  it('retains a retired name so it is never reissued', async () => {
    const store = await createStore()
    store.addRetiredWorktreeName(REPO, 'Nautilus')
    expect(store.getRetiredWorktreeNames(REPO)).toEqual(['nautilus'])
  })

  it('scopes retirement per repo so one repo does not burn another pool', async () => {
    const store = await createStore()
    store.addRetiredWorktreeName(REPO, 'nautilus')
    expect(store.getRetiredWorktreeNames(OTHER_REPO)).toEqual([])
  })

  it('normalizes case and whitespace so a name cannot be retired twice', async () => {
    const store = await createStore()
    store.addRetiredWorktreeName(REPO, '  NaUtIlUs ')
    store.addRetiredWorktreeName(REPO, 'nautilus')
    expect(store.getRetiredWorktreeNames(REPO)).toEqual(['nautilus'])
  })

  it('ignores an empty name or missing repo id', async () => {
    const store = await createStore()
    store.addRetiredWorktreeName(REPO, '   ')
    store.addRetiredWorktreeName('', 'nautilus')
    expect(store.getRetiredWorktreeNames(REPO)).toEqual([])
  })

  it('does not persist arbitrary user and issue-title names', async () => {
    const store = await createStore()
    store.addRetiredWorktreeName(REPO, 'fix-login-redirect')
    store.addRetiredWorktreeName(REPO, 'STA-4189-duplicate-name')
    expect(store.getRetiredWorktreeNames(REPO)).toEqual([])
  })

  it('returns a copy so callers cannot mutate the registry in place', async () => {
    const store = await createStore()
    store.addRetiredWorktreeName(REPO, 'nautilus')
    store.getRetiredWorktreeNames(REPO).push('seahorse')
    expect(store.getRetiredWorktreeNames(REPO)).toEqual(['nautilus'])
  })

  it('merges backfilled names without dropping a concurrent retirement', async () => {
    const store = await createStore()
    store.addRetiredWorktreeName(REPO, 'nautilus')
    expect(store.mergeRetiredWorktreeNames(REPO, ['seahorse', 'starfish'])).toBe(true)
    expect(store.getRetiredWorktreeNames(REPO).sort()).toEqual(['nautilus', 'seahorse', 'starfish'])
  })

  it('reports no change when a merge adds nothing new', async () => {
    const store = await createStore()
    store.addRetiredWorktreeName(REPO, 'nautilus')
    expect(store.mergeRetiredWorktreeNames(REPO, ['NAUTILUS'])).toBe(false)
  })

  it('survives a reload so retirement outlives the workspace and the app session', async () => {
    const store = await createStore({
      retiredWorktreeNamesByRepo: { [REPO]: ['nautilus', 'seahorse'] }
    })
    expect(store.getRetiredWorktreeNames(REPO).sort()).toEqual(['nautilus', 'seahorse'])
  })

  it('degrades to nothing retired when the persisted map is corrupt', async () => {
    // Why: a load failure costs the app; over- or under-retiring costs at most a name.
    const store = await createStore({ retiredWorktreeNamesByRepo: 'not-an-object' })
    expect(store.getRetiredWorktreeNames(REPO)).toEqual([])
  })

  it('drops non-string entries but keeps the valid ones', async () => {
    const store = await createStore({
      retiredWorktreeNamesByRepo: { [REPO]: ['nautilus', 42, null, 'Seahorse'] }
    })
    expect(store.getRetiredWorktreeNames(REPO).sort()).toEqual(['nautilus', 'seahorse'])
  })

  it('drops the registry when the repo is removed, matching the sparse-preset convention', async () => {
    // Why: entries are repo-id keyed, so without this they orphan forever — a repo id is never
    // reused, and remove/re-add mints a new one.
    const store = await createStore()
    store.addRepo({ id: REPO, path: '/repos/a', displayName: 'a', badgeColor: '', addedAt: 0 })
    store.addRetiredWorktreeName(REPO, 'nautilus')

    store.removeProject(REPO)

    expect(store.getRetiredWorktreeNames(REPO)).toEqual([])
  })

  it('keeps the registry when one host row is removed but the repo id survives elsewhere', async () => {
    const store = await createStore()
    store.addRepo({ id: REPO, path: '/repos/a', displayName: 'a', badgeColor: '', addedAt: 0 })
    store.addRepo({
      id: REPO,
      path: '/repos/a',
      displayName: 'a',
      badgeColor: '',
      addedAt: 0,
      executionHostId: 'runtime:env-1'
    } as never)
    store.addRetiredWorktreeName(REPO, 'nautilus')

    store.removeProjectForHost(REPO, 'runtime:env-1')

    expect(store.getRetiredWorktreeNames(REPO)).toEqual(['nautilus'])

    store.removeProjectForHost(REPO, 'local')

    expect(store.getRetiredWorktreeNames(REPO)).toEqual([])
  })

  it('bounds the per-repo registry above the pool so the cap never reissues a base name', async () => {
    // The cap must sit well past the 552-name pool: evicting inside it would hand back a name whose
    // agent state is still on disk, which is the bug this registry exists to prevent.
    const store = await createStore()
    const names = MARINE_CREATURES.map((name) => name.toLowerCase())
    for (let tier = 2; tier <= 5; tier += 1) {
      store.mergeRetiredWorktreeNames(
        REPO,
        names.map((name) => `${name}-${tier}`)
      )
    }
    store.mergeRetiredWorktreeNames(REPO, names)

    const retained = store.getRetiredWorktreeNames(REPO)
    expect(retained.length).toBe(2000)
    // Oldest-first eviction, so the most recent merge survives intact.
    expect(retained).toEqual(expect.arrayContaining(names))
  })

  it('drops legacy arbitrary names while loading the persisted map', async () => {
    const store = await createStore({
      retiredWorktreeNamesByRepo: { [REPO]: ['fix-login', 'Nautilus'] }
    })
    expect(store.getRetiredWorktreeNames(REPO)).toEqual(['nautilus'])
  })
})
