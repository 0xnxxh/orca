import { describe, expect, it, vi } from 'vitest'
import { createTestStore } from './store-test-helpers'
import type { FolderWorkspacePathStatusCacheEntry } from './repos'
import type { Repo } from '../../../../shared/types'
import {
  installReposRuntimeRoutingHarness,
  localRepo,
  reposList
} from './repos-runtime-routing-fixture'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }
}))

installReposRuntimeRoutingHarness()

// Why: a catalog refresh that changes nothing must leave every slice referentially stable —
// identity-keyed memos and store subscribers key off these arrays. Fixtures here are
// production-shaped on purpose; scalar-only repos reconcile even when the compare is broken.
describe('repo catalog refresh identity', () => {
  it('keeps the repos array identity across a refetch that changes nothing', async () => {
    // Why: main rebuilds nested records (hookSettings et al) per list and IPC clones them, so a
    // production-shaped repo — not a scalar-only fixture — is what proves reconciliation works.
    const hydrated = (): Repo => ({
      ...localRepo,
      kind: 'git',
      gitUsername: 'octocat',
      hookSettings: { mode: 'auto', scripts: { setup: 'echo hi', archive: '' } },
      gitRemoteIdentity: {
        canonicalKey: 'github.com/octocat/local',
        remoteName: 'origin',
        remoteUrl: 'git@github.com:octocat/local.git'
      },
      importedExternalWorktreePaths: ['/local/wt']
    })
    reposList.mockImplementation(async () => [hydrated()])
    const store = createTestStore()
    await store.getState().fetchRepos()
    const reposRef = store.getState().repos

    await store.getState().fetchRepos()

    // Why: identity-keyed renderer memos (repo lookup index, selectors) rebuild on a new array.
    expect(store.getState().repos).toBe(reposRef)
    expect(store.getState().repos[0]).toBe(reposRef[0])
  })

  it('keeps projects and host setups identity across a refetch that changes nothing', async () => {
    // Why: the compat merge rebuilds sourceRepoIds per project and setups arrive freshly cloned,
    // so only a structural reconcile recovers identity — a scalar-only fixture would pass anyway.
    const hydrated = (): Repo => ({
      ...localRepo,
      kind: 'git',
      hookSettings: { mode: 'auto', scripts: { setup: 'echo hi', archive: '' } },
      gitRemoteIdentity: {
        canonicalKey: 'github.com/octocat/local',
        remoteName: 'origin',
        remoteUrl: 'git@github.com:octocat/local.git'
      }
    })
    reposList.mockImplementation(async () => [hydrated()])
    const store = createTestStore()
    await store.getState().fetchRepos()
    const projectsRef = store.getState().projects
    const setupsRef = store.getState().projectHostSetups

    await store.getState().fetchRepos()

    expect(store.getState().projects).toBe(projectsRef)
    expect(store.getState().projects[0]).toBe(projectsRef[0])
    expect(store.getState().projectHostSetups).toBe(setupsRef)
    expect(store.getState().projectHostSetups[0]).toBe(setupsRef[0])
  })

  it('replaces projects and host setups identity when a refetch adds a repo', async () => {
    reposList.mockResolvedValue([localRepo])
    const store = createTestStore()
    await store.getState().fetchRepos()
    const projectsRef = store.getState().projects
    const setupsRef = store.getState().projectHostSetups
    reposList.mockResolvedValue([localRepo, { ...localRepo, id: 'second', path: '/second' }])

    await store.getState().fetchRepos()

    expect(store.getState().projects).not.toBe(projectsRef)
    expect(store.getState().projectHostSetups).not.toBe(setupsRef)
    expect(store.getState().projects).toHaveLength(2)
  })

  it('keeps the repo filter array identity when a refetch prunes nothing', async () => {
    reposList.mockResolvedValue([localRepo])
    const store = createTestStore()
    store.setState({ filterRepoIds: [localRepo.id] })
    const filterRef = store.getState().filterRepoIds

    await store.getState().fetchRepos()

    // Why: App.tsx and five sidebar consumers select this array by identity.
    expect(store.getState().filterRepoIds).toBe(filterRef)
  })

  it('still prunes filtered repo ids that no longer exist', async () => {
    reposList.mockResolvedValue([localRepo])
    const store = createTestStore()
    store.setState({ filterRepoIds: [localRepo.id, 'gone'] })

    await store.getState().fetchRepos()

    expect(store.getState().filterRepoIds).toEqual([localRepo.id])
  })

  it('keeps the folder workspace path status map identity when there is nothing to drop', async () => {
    reposList.mockResolvedValue([localRepo])
    const store = createTestStore()
    const statusesRef = store.getState().folderWorkspacePathStatuses

    await store.getState().fetchRepos()

    // Why: sidebar rows shallow-select this map, so a fresh {} re-renders the whole list.
    expect(store.getState().folderWorkspacePathStatuses).toBe(statusesRef)
  })

  it('still drops cached folder workspace path statuses on a catalog fetch', async () => {
    reposList.mockResolvedValue([localRepo])
    const store = createTestStore()
    const stale: Record<string, FolderWorkspacePathStatusCacheEntry> = {
      stale: {
        status: { path: '/gone', exists: false },
        checkedAt: 1,
        requestSnapshot: 'old'
      }
    }
    store.setState({ folderWorkspacePathStatuses: stale })

    await store.getState().fetchRepos()

    expect(store.getState().folderWorkspacePathStatuses).toEqual({})
  })

  it('replaces the repos array identity when a refetch adds a repo', async () => {
    reposList.mockResolvedValue([localRepo])
    const store = createTestStore()
    await store.getState().fetchRepos()
    const reposRef = store.getState().repos
    reposList.mockResolvedValue([localRepo, { ...localRepo, id: 'second', path: '/second' }])

    await store.getState().fetchRepos()

    expect(store.getState().repos).not.toBe(reposRef)
    expect(store.getState().repos).toHaveLength(2)
  })
})
