import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDefaultPersistedState } from '../shared/constants'

const testState = { dir: '' }

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('./telemetry/client', () => ({ track: vi.fn() }))
vi.mock('./telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

// The registry is keyed by the cwd namespace a repo creates into, not by repo id.
const KEY = 'local:posix:/workspaces/repo-1'
const OTHER_KEY = 'local:posix:/workspaces/repo-2'

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
    store.addRetiredWorktreeName(KEY, 'Nautilus')
    expect(store.getRetiredWorktreeNames(KEY)).toEqual(['nautilus'])
  })

  it('scopes retirement per cwd namespace so one workspace root does not burn another', async () => {
    const store = await createStore()
    store.addRetiredWorktreeName(KEY, 'nautilus')
    expect(store.getRetiredWorktreeNames(OTHER_KEY)).toEqual([])
  })

  it('normalizes case and whitespace so a name cannot be retired twice', async () => {
    const store = await createStore()
    store.addRetiredWorktreeName(KEY, '  NaUtIlUs ')
    store.addRetiredWorktreeName(KEY, 'nautilus')
    expect(store.getRetiredWorktreeNames(KEY)).toEqual(['nautilus'])
  })

  it('ignores an empty name or missing workspace key', async () => {
    const store = await createStore()
    store.addRetiredWorktreeName(KEY, '   ')
    store.addRetiredWorktreeName('', 'nautilus')
    expect(store.getRetiredWorktreeNames(KEY)).toEqual([])
  })

  it('does not persist arbitrary user and issue-title names', async () => {
    const store = await createStore()
    store.addRetiredWorktreeName(KEY, 'fix-login-redirect')
    store.addRetiredWorktreeName(KEY, 'STA-4189-duplicate-name')
    expect(store.getRetiredWorktreeNames(KEY)).toEqual([])
  })

  it('returns a copy so callers cannot mutate the registry in place', async () => {
    const store = await createStore()
    store.addRetiredWorktreeName(KEY, 'nautilus')
    store.getRetiredWorktreeNames(KEY).push('seahorse')
    expect(store.getRetiredWorktreeNames(KEY)).toEqual(['nautilus'])
  })

  it('merges backfilled names without dropping a concurrent retirement', async () => {
    const store = await createStore()
    store.addRetiredWorktreeName(KEY, 'nautilus')
    expect(store.mergeRetiredWorktreeNames(KEY, ['seahorse', 'starfish'])).toBe(true)
    expect(store.getRetiredWorktreeNames(KEY).sort()).toEqual(['nautilus', 'seahorse', 'starfish'])
  })

  it('reports no change when a merge adds nothing new', async () => {
    const store = await createStore()
    store.addRetiredWorktreeName(KEY, 'nautilus')
    expect(store.mergeRetiredWorktreeNames(KEY, ['NAUTILUS'])).toBe(false)
  })

  it('survives a reload so retirement outlives the workspace and the app session', async () => {
    const store = await createStore({
      retiredWorktreeNamesByWorkspaceKey: { [KEY]: ['nautilus', 'seahorse'] }
    })
    expect(store.getRetiredWorktreeNames(KEY).sort()).toEqual(['nautilus', 'seahorse'])
  })

  it('degrades to nothing retired when the persisted map is corrupt', async () => {
    // Why: a load failure costs the app; over- or under-retiring costs at most a name.
    const store = await createStore({ retiredWorktreeNamesByWorkspaceKey: 'not-an-object' })
    expect(store.getRetiredWorktreeNames(KEY)).toEqual([])
  })

  it('drops non-string entries but keeps the valid ones', async () => {
    const store = await createStore({
      retiredWorktreeNamesByWorkspaceKey: { [KEY]: ['nautilus', 42, null, 'Seahorse'] }
    })
    expect(store.getRetiredWorktreeNames(KEY).sort()).toEqual(['nautilus', 'seahorse'])
  })

  it('drops legacy arbitrary names while loading the persisted map', async () => {
    const store = await createStore({
      retiredWorktreeNamesByWorkspaceKey: { [KEY]: ['fix-login', 'Nautilus'] }
    })
    expect(store.getRetiredWorktreeNames(KEY)).toEqual(['nautilus'])
  })
})
