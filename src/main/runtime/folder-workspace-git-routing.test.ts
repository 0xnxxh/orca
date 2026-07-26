import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, appendFileSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { OrcaRuntimeService } from './orca-runtime'
import { folderWorkspaceKey } from '../../shared/workspace-scope'
import { RpcDispatcher } from './rpc/dispatcher'
import { GIT_METHODS } from './rpc/methods/git'
import type { FolderWorkspace, ProjectGroup, Repo, WorktreeMeta } from '../../shared/types'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') }
}))

const FIXTURE = `${realpathSync('/tmp')}/hotbugs/fixture-6357`
const CONTAINER = join(FIXTURE, 'fint')
const CHILD_API = join(CONTAINER, 'fint_api')
const CHILD_WT = join(FIXTURE, 'wt-fint_api-refund')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function buildFixture(): void {
  rmSync(FIXTURE, { recursive: true, force: true })
  for (const repo of ['fint_api', 'fint-portal']) {
    const dir = join(CONTAINER, repo)
    mkdirSync(join(dir, 'src'), { recursive: true })
    git(dir, 'init', '-q', '-b', 'master', '.')
    git(dir, 'config', 'user.email', 'a@b.c')
    git(dir, 'config', 'user.name', 't')
    writeFileSync(join(dir, 'src', 'app.ts'), 'export {}\n')
    writeFileSync(join(dir, '.eslintrc.json'), '{}\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', 'init')
    appendFileSync(join(dir, 'src', 'app.ts'), 'export const x = 1\n')
    writeFileSync(join(dir, 'src', 'new-file.ts'), 'new\n')
  }
  git(CHILD_API, 'worktree', 'add', '-q', '-b', 'feature/refund', CHILD_WT)
  appendFileSync(join(CHILD_WT, 'src', 'app.ts'), 'worktree edit\n')
}

const FOLDER_WS_ID = 'fw-1'
const GROUP_ID = 'pg-1'

function repo(id: string, path: string, kind: 'folder' | 'git'): Repo {
  return { id, path, displayName: id, badgeColor: 'blue', addedAt: 1, kind, connectionId: null }
}

/** Both child repos registered, matching a user who imported the whole container. */
function allRepos(): Repo[] {
  return [
    repo('folder-repo', CONTAINER, 'folder'),
    repo('fint-api-repo', CHILD_API, 'git'),
    repo('fint-portal-repo', join(CONTAINER, 'fint-portal'), 'git')
  ]
}

function makeStore(overrides: { repos?: Repo[] } = {}): unknown {
  const folderRepo: Repo = {
    id: 'folder-repo',
    path: CONTAINER,
    displayName: 'fint',
    badgeColor: 'blue',
    addedAt: 1,
    kind: 'folder',
    connectionId: null
  }
  const childRepo: Repo = {
    id: 'fint-api-repo',
    path: CHILD_API,
    displayName: 'fint_api',
    badgeColor: 'blue',
    addedAt: 1,
    kind: 'git',
    connectionId: null
  }
  const repos = overrides.repos ?? [folderRepo, childRepo]
  const group: ProjectGroup = {
    id: GROUP_ID,
    name: 'fint',
    parentPath: CONTAINER,
    parentGroupId: null,
    createdFrom: 'folder-scan',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1
  }
  const folderWorkspace: FolderWorkspace = {
    id: FOLDER_WS_ID,
    projectGroupId: GROUP_ID,
    name: 'Refund fix',
    folderPath: CONTAINER,
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1,
    createdAt: 1,
    updatedAt: 1
  }
  const meta: Record<string, WorktreeMeta> = {}
  return {
    getRepo: (id: string) => repos.find((r) => r.id === id),
    getRepos: () => repos,
    addRepo: () => {},
    updateRepo: (id: string, u: Record<string, unknown>) => ({
      ...repos.find((r) => r.id === id),
      ...u
    }),
    getAllWorktreeMeta: () => meta,
    getWorktreeMeta: (id: string) => meta[id],
    setWorktreeMeta: (id: string, patch: Record<string, unknown>) => {
      meta[id] = { ...meta[id], ...patch } as WorktreeMeta
      return meta[id]
    },
    removeWorktreeMeta: () => {},
    getSparsePresets: () => [],
    saveSparsePreset: (p: unknown) => p,
    getGitHubCache: () => undefined,
    getSettings: () => ({
      workspaceDir: '/tmp/workspaces',
      nestWorkspaces: false,
      refreshLocalBaseRefOnWorktreeCreate: false,
      branchPrefix: 'none',
      branchPrefixCustom: ''
    }),
    getProjects: () => [],
    getProjectGroups: () => [group],
    getFolderWorkspaces: () => [folderWorkspace]
  }
}

describe('#6357 monorepo folder workspace', () => {
  it('A: file explorer resolves for a folder workspace (merged #6569 path)', async () => {
    buildFixture()
    const runtime = new OrcaRuntimeService(makeStore() as never)
    const selector = `id:${folderWorkspaceKey(FOLDER_WS_ID)}`
    const entries = await runtime.readFileExplorerDir(selector, 'fint_api/src')
    expect(entries.map((e) => e.name).sort()).toContain('app.ts')
  })

  it('B: git status lists changes from every child repo, workspace-relative', async () => {
    buildFixture()
    const runtime = new OrcaRuntimeService(makeStore({ repos: allRepos() }) as never)
    const selector = `id:${folderWorkspaceKey(FOLDER_WS_ID)}`
    const status = await runtime.getRuntimeGitStatus(selector)
    const paths = status.entries.map((entry) => entry.path).sort()
    expect(paths).toEqual([
      'fint-portal/src/app.ts',
      'fint-portal/src/new-file.ts',
      'fint_api/src/app.ts',
      'fint_api/src/new-file.ts'
    ])
    // Why: no single HEAD describes N repos, so the merge must not claim one.
    expect(status.head).toBeUndefined()
    expect(status.branch).toBeUndefined()
  })

  it('C: git diff for the SAME folder-workspace selector resolves the owning child repo', async () => {
    buildFixture()
    const runtime = new OrcaRuntimeService(makeStore() as never)
    const selector = `id:${folderWorkspaceKey(FOLDER_WS_ID)}`
    const diff = await runtime.getRuntimeGitDiff(selector, 'fint_api/src/app.ts', false)
    expect(JSON.stringify(diff)).toContain('export const x = 1')
  })

  it('C2: a workspace-relative path escaping the folder does not resolve to another repo', async () => {
    buildFixture()
    const runtime = new OrcaRuntimeService(makeStore() as never)
    const selector = `id:${folderWorkspaceKey(FOLDER_WS_ID)}`
    const caught = await runtime
      .getRuntimeGitDiff(selector, '../wt-fint_api-refund/src/app.ts', false)
      .then(() => null)
      .catch((err: unknown) => String(err))
    // Rejected by relative-path normalization before routing ever sees it.
    expect(caught).toContain('invalid_relative_path')
  })

  it('D: the folder REPO placeholder selector still reports an empty, non-repo status', async () => {
    buildFixture()
    const runtime = new OrcaRuntimeService(makeStore() as never)
    // The folder repo's placeholder worktree points at the container, which is not a
    // git repo. Unchanged by this fix; the folder-WORKSPACE selector is the fixed path.
    const status = await runtime.getRuntimeGitStatus(`id:folder-repo::${CONTAINER}`)
    expect(status.entries).toEqual([])
  })

  it('F: the RPC surface the renderer actually calls succeeds end to end', async () => {
    buildFixture()
    const runtime = new OrcaRuntimeService(makeStore({ repos: allRepos() }) as never)
    const dispatcher = new RpcDispatcher({ runtime, methods: GIT_METHODS })
    const selector = `id:${folderWorkspaceKey(FOLDER_WS_ID)}`

    const diffResponse = await dispatcher.dispatch({
      id: 'r1',
      authToken: 'tok',
      method: 'git.diff',
      params: { worktree: selector, filePath: 'fint_api/src/app.ts', staged: false }
    })
    const statusResponse = await dispatcher.dispatch({
      id: 'r2',
      authToken: 'tok',
      method: 'git.status',
      params: { worktree: selector }
    })
    expect(diffResponse).toMatchObject({ ok: true })
    expect(statusResponse).toMatchObject({ ok: true })
    // Why: status must list a path that git.diff can then resolve — the two
    // surfaces have to agree on the same addressing scheme.
    const listed = (statusResponse as { result: { entries: { path: string }[] } }).result.entries
    expect(listed.map((entry) => entry.path)).toContain('fint_api/src/app.ts')
  })

  it('H: every file status lists can then be staged, unstaged and discarded', async () => {
    buildFixture()
    const runtime = new OrcaRuntimeService(makeStore({ repos: allRepos() }) as never)
    const selector = `id:${folderWorkspaceKey(FOLDER_WS_ID)}`
    // Why: listing a file the user then cannot act on is worse than listing nothing.
    for (const entry of (await runtime.getRuntimeGitStatus(selector)).entries) {
      await runtime.stageRuntimeGitPath(selector, entry.path)
    }
    const staged = await runtime.getRuntimeGitStatus(selector)
    expect(staged.entries.every((entry) => entry.area === 'staged')).toBe(true)

    await runtime.unstageRuntimeGitPath(selector, 'fint_api/src/app.ts')
    const unstaged = await runtime.getRuntimeGitStatus(selector)
    expect(unstaged.entries.find((entry) => entry.path === 'fint_api/src/app.ts')?.area).toBe(
      'unstaged'
    )

    await runtime.discardRuntimeGitPath(selector, 'fint_api/src/app.ts')
    const discarded = await runtime.getRuntimeGitStatus(selector)
    expect(discarded.entries.map((entry) => entry.path)).not.toContain('fint_api/src/app.ts')
  })

  it('I: a bulk request spanning two child repos stages every path in both', async () => {
    buildFixture()
    const runtime = new OrcaRuntimeService(makeStore({ repos: allRepos() }) as never)
    const selector = `id:${folderWorkspaceKey(FOLDER_WS_ID)}`
    await runtime.bulkStageRuntimeGitPaths(selector, [
      'fint_api/src/app.ts',
      'fint-portal/src/app.ts',
      'fint-portal/src/new-file.ts'
    ])
    const status = await runtime.getRuntimeGitStatus(selector)
    const stagedPaths = status.entries
      .filter((entry) => entry.area === 'staged')
      .map((entry) => entry.path)
      .sort()
    expect(stagedPaths).toEqual([
      'fint-portal/src/app.ts',
      'fint-portal/src/new-file.ts',
      'fint_api/src/app.ts'
    ])
  })

  it('J: a bulk request naming a path no child repo owns fails instead of partially applying', async () => {
    buildFixture()
    const runtime = new OrcaRuntimeService(makeStore({ repos: allRepos() }) as never)
    const selector = `id:${folderWorkspaceKey(FOLDER_WS_ID)}`
    const caught = await runtime
      .bulkStageRuntimeGitPaths(selector, ['fint_api/src/app.ts', 'not-a-repo/x.ts'])
      .then(() => null)
      .catch((err: unknown) => String(err))
    expect(caught).toContain('selector_not_found')
    // Why: the whole batch must be rejected before any repo is mutated.
    const status = await runtime.getRuntimeGitStatus(selector)
    expect(status.entries.every((entry) => entry.area !== 'staged')).toBe(true)
  })

  it('E: the real child git worktree resolves fine when its repo is registered', async () => {
    buildFixture()
    const runtime = new OrcaRuntimeService(makeStore() as never)
    const status = await runtime.getRuntimeGitStatus(`path:${CHILD_WT}`)
    expect(status.entries.map((entry) => entry.path)).toContain('src/app.ts')
    expect(status.branch).toBe('refs/heads/feature/refund')
  })
})
