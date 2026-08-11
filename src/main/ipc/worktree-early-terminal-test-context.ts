import { vi, type Mock } from 'vitest'
import type { CreateWorktreeArgs, Repo } from '../../shared/types'
import type * as WorktreeCreateTimingModule from '../worktree-create-timing'
import type * as WorktreePushTargetSetupModule from './worktree-push-target-setup'

const ORIGINAL_PLATFORM_DESCRIPTOR = Object.getOwnPropertyDescriptor(process, 'platform')
export const REPO_PATH = '/tmp/orca-early-terminal-repo'
export const WORKSPACE_PATH = '/tmp/orca-early-terminal-workspaces'
export const AGENT_TELEMETRY = {
  agent_kind: 'codex',
  launch_source: 'new_workspace_composer',
  request_kind: 'new'
} as const

type TestMocks = Record<string, Mock>
type TestMainWindow = { isDestroyed: () => boolean; webContents: { send: Mock } }

const mocks: TestMocks = vi.hoisted(() => ({
  addWorktree: vi.fn(),
  addSparseWorktree: vi.fn(),
  listWorktrees: vi.fn(),
  listWorktreeGraph: vi.fn(),
  materializeWorktreeCheckout: vi.fn(),
  rollbackFailedWorktreeCreate: vi.fn(),
  getBranchConflictKind: vi.fn(),
  gitExecFileAsync: vi.fn(),
  getEffectiveHooks: vi.fn(),
  getEffectiveHooksFromConfig: vi.fn(),
  getDefaultTabsLaunch: vi.fn(),
  loadHooks: vi.fn(),
  createSetupRunnerScript: vi.fn(),
  resolveSetupRunnerShell: vi.fn(),
  shouldRunSetupForCreate: vi.fn(),
  resolveWorktreeIncludePaths: vi.fn(),
  resolveWorktreeSharedDirectories: vi.fn(),
  createWorktreeCopiedPaths: vi.fn(),
  createWorktreeLinkedPaths: vi.fn(),
  createWorktreeSharedPaths: vi.fn(),
  computeWorktreePath: vi.fn(),
  registerWorktreeRootsForRepo: vi.fn(),
  runWorktreeChangeInvalidators: vi.fn(),
  validateGitPushTarget: vi.fn(),
  prepareWorktreePushTargetWithExec: vi.fn(),
  configureCreatedWorktreePushTargetWithExec: vi.fn(),
  getLocalProjectGitExecOptions: vi.fn(),
  getLocalProjectWorktreeGitOptions: vi.fn(),
  logWorktreeCreateTiming: vi.fn(),
  track: vi.fn(),
  getCohortAtEmit: vi.fn(() => ({ nth_repo_added: 3 })),
  markCodexProjectTrusted: vi.fn(),
  markCopilotFolderTrusted: vi.fn(),
  markCursorWorkspaceTrusted: vi.fn()
}))

vi.mock('../git/worktree', () => ({
  addWorktree: mocks.addWorktree,
  addSparseWorktree: mocks.addSparseWorktree,
  listWorktrees: mocks.listWorktrees,
  listWorktreeGraph: mocks.listWorktreeGraph,
  materializeWorktreeCheckout: mocks.materializeWorktreeCheckout,
  rollbackFailedWorktreeCreate: mocks.rollbackFailedWorktreeCreate
}))

vi.mock('../git/repo', () => ({
  getBranchConflictKind: mocks.getBranchConflictKind,
  resolveDefaultBaseRefViaExec: vi.fn(),
  resolveDefaultBaseRefWithLocalGit: vi.fn()
}))

vi.mock('../git/git-username', () => ({
  getSshGitUsername: vi.fn(),
  resolveLocalGitUsername: vi.fn().mockResolvedValue('')
}))

vi.mock('../git/runner', () => ({ gitExecFileAsync: mocks.gitExecFileAsync }))
vi.mock('../git/push-target-validation', () => ({
  validateGitPushTarget: mocks.validateGitPushTarget
}))

vi.mock('./worktree-push-target-setup', async (importOriginal) => ({
  ...(await importOriginal<typeof WorktreePushTargetSetupModule>()),
  prepareWorktreePushTargetWithExec: mocks.prepareWorktreePushTargetWithExec,
  configureCreatedWorktreePushTargetWithExec: mocks.configureCreatedWorktreePushTargetWithExec
}))

vi.mock('../github/client', () => ({ getPRForBranch: vi.fn().mockResolvedValue(null) }))
vi.mock('../source-control/hosted-review', () => ({ getHostedReviewForBranch: vi.fn() }))

vi.mock('../hooks', () => ({
  buildPosixRunnerScript: vi.fn(),
  buildWindowsRunnerScript: vi.fn(),
  createSetupRunnerScript: mocks.createSetupRunnerScript,
  getDefaultTabsLaunch: mocks.getDefaultTabsLaunch,
  getEffectiveHooks: mocks.getEffectiveHooks,
  getEffectiveHooksFromConfig: mocks.getEffectiveHooksFromConfig,
  getSetupRunnerEnvVars: vi.fn(),
  loadHooks: mocks.loadHooks,
  parseOrcaYaml: vi.fn(),
  resolveSetupRunnerShell: mocks.resolveSetupRunnerShell,
  shouldRunSetupForCreate: mocks.shouldRunSetupForCreate
}))

vi.mock('../providers/ssh-git-dispatch', () => ({ requireSshGitProvider: vi.fn() }))
vi.mock('../providers/ssh-filesystem-dispatch', () => ({ getSshFilesystemProvider: vi.fn() }))

vi.mock('./worktree-logic', () => ({
  sanitizeWorktreeName: (name: string) => name,
  sanitizeWorktreeDisplayName: (name: string) => name,
  computeValidatedBranchName: (name: string) => name,
  computeWorktreePath: mocks.computeWorktreePath,
  computeRemoteWorktreePath: vi.fn(),
  computeWorkspaceRoot: () => WORKSPACE_PATH,
  ensurePathWithinWorkspace: (path: string) => path,
  getWorktreeCreationLayout: () => ({ path: WORKSPACE_PATH, nestWorkspaces: false }),
  getWorktreePathSettings: () => ({ workspaceDir: WORKSPACE_PATH, nestWorkspaces: false }),
  hasRepoWorktreeBasePath: vi.fn(),
  shouldSetDisplayName: () => false,
  mergeWorktree: (
    repoId: string,
    worktree: {
      path: string
      head: string
      branch: string
      isBare: boolean
      isMainWorktree: boolean
    },
    meta: Record<string, unknown>
  ) => ({
    id: `${repoId}::${worktree.path}`,
    repoId,
    ...worktree,
    ...meta
  })
}))

vi.mock('./filesystem-auth', () => ({
  isENOENT: () => false,
  registerWorktreeRootsForRepo: mocks.registerWorktreeRootsForRepo
}))

vi.mock('./worktree-symlinks', () => ({
  createWorktreeCopiedPaths: mocks.createWorktreeCopiedPaths,
  createWorktreeLinkedPaths: mocks.createWorktreeLinkedPaths,
  createWorktreeSharedPaths: mocks.createWorktreeSharedPaths
}))

vi.mock('../git/worktree-include-file', () => ({
  resolveWorktreeIncludePaths: mocks.resolveWorktreeIncludePaths
}))

vi.mock('../git/worktree-shared-directories', () => ({
  resolveWorktreeSharedDirectories: mocks.resolveWorktreeSharedDirectories
}))

vi.mock('../agent-trust-presets', () => ({
  markCodexProjectTrusted: mocks.markCodexProjectTrusted,
  markCopilotFolderTrusted: mocks.markCopilotFolderTrusted,
  markCursorWorkspaceTrusted: mocks.markCursorWorkspaceTrusted
}))

vi.mock('../project-runtime-git-options', () => ({
  getLocalProjectGitExecOptions: mocks.getLocalProjectGitExecOptions,
  getLocalProjectWorktreeGitOptions: mocks.getLocalProjectWorktreeGitOptions
}))

vi.mock('../worktree-create-base', () => ({
  resolveWorktreeCreateBase: vi.fn(
    async ({ requestedBaseBranch }: { requestedBaseBranch?: string }) =>
      requestedBaseBranch ?? 'main'
  )
}))

vi.mock('../worktree-create-timing', async (importOriginal) => {
  const actual = await importOriginal<typeof WorktreeCreateTimingModule>()
  return { ...actual, logWorktreeCreateTiming: mocks.logWorktreeCreateTiming }
})

vi.mock('../telemetry/client', () => ({ track: mocks.track }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: mocks.getCohortAtEmit }))
vi.mock('./worktree-change-invalidators', () => ({
  runWorktreeChangeInvalidators: mocks.runWorktreeChangeInvalidators
}))
vi.mock('./ssh-worktree-create-root-registration', () => ({
  registerOptionalSshWorktreeCreateRoots: vi.fn(),
  registerRequiredSshWorktreeCreateRoots: vi.fn()
}))

import { createLocalWorktree } from './worktree-remote'

export type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

export function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
}

export function restorePlatform(): void {
  if (ORIGINAL_PLATFORM_DESCRIPTOR) {
    Object.defineProperty(process, 'platform', ORIGINAL_PLATFORM_DESCRIPTOR)
  }
}

export function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: REPO_PATH,
    displayName: 'Repo',
    badgeColor: 'blue',
    addedAt: 0,
    ...overrides
  }
}

export function makeStore(settingsOverrides: Record<string, unknown> = {}): TestMocks {
  return {
    getSettings: vi.fn(() => ({
      branchPrefix: 'none',
      localBaseRefSuggestionDismissed: true,
      nestWorkspaces: false,
      refreshLocalBaseRefOnWorktreeCreate: false,
      setupScriptLaunchMode: 'new-tab',
      workspaceDir: WORKSPACE_PATH,
      ...settingsOverrides
    })),
    getSparsePresets: vi.fn(() => []),
    getWorktreeMeta: vi.fn(),
    getProjectHostSetups: vi.fn(() => []),
    setWorktreeMeta: vi.fn((_id: string, meta: Record<string, unknown>) => meta),
    setWorkspaceLineage: vi.fn((lineage: Record<string, unknown>) => lineage),
    removeWorktreeMeta: vi.fn()
  }
}

export function makeRuntime(): TestMocks {
  const terminalCreationPermit = Symbol('terminal-creation-permit')
  return {
    resolveRemoteTrackingBase: vi.fn().mockResolvedValue(null),
    hasRemoteTrackingRef: vi.fn().mockResolvedValue(false),
    getOrStartRemoteTrackingBaseRefresh: vi.fn().mockResolvedValue({ ok: true }),
    fetchRemoteWithCache: vi.fn().mockResolvedValue(undefined),
    beginWorktreeTerminalCreationBarrier: vi.fn().mockResolvedValue(terminalCreationPermit),
    endWorktreeTerminalCreationBarrier: vi.fn(),
    failWorktreeTerminalCreationBarrier: vi.fn(),
    clearWorktreeTerminalCreationBarrier: vi.fn(),
    stopTerminalsForFailedWorktreeCreate: vi.fn().mockResolvedValue(undefined),
    createTerminal: vi.fn().mockResolvedValue({
      handle: 'terminal-1',
      ptyId: 'pty-1',
      surface: 'visible',
      worktreeId: 'repo-1::worktree'
    }),
    splitTerminal: vi.fn(),
    closeTerminal: vi.fn().mockResolvedValue(undefined),
    stopExactTerminalsForWorktree: vi.fn().mockResolvedValue({
      stopped: 1,
      stoppedPtyIds: ['pty-1'],
      livePtyIds: ['pty-1'],
      postStopVerified: true
    }),
    sendTerminal: vi.fn().mockResolvedValue(undefined),
    sendTerminalHandshake: vi.fn().mockResolvedValue(undefined)
  }
}

export function makeMainWindow(): TestMainWindow {
  return {
    isDestroyed: () => false,
    webContents: { send: vi.fn() }
  }
}

export async function createTestWorktree(
  args: Partial<CreateWorktreeArgs> = {},
  options?: {
    commitEarlyStartup?: () => boolean
    earlyStartupSignal?: AbortSignal
    mainWindow?: ReturnType<typeof makeMainWindow>
    repo?: Repo
    runtime?: ReturnType<typeof makeRuntime>
    store?: ReturnType<typeof makeStore>
  }
): Promise<{
  result: Awaited<ReturnType<typeof createLocalWorktree>>
  mainWindow: TestMainWindow
  repo: Repo
  runtime: TestMocks | undefined
  store: TestMocks
}> {
  const repo = options?.repo ?? makeRepo()
  const store = options?.store ?? makeStore()
  const runtime = options && 'runtime' in options ? options.runtime : makeRuntime()
  const mainWindow = options?.mainWindow ?? makeMainWindow()
  const result = await createLocalWorktree(
    {
      repoId: repo.id,
      name: 'early-terminal',
      baseBranch: 'main',
      ...args
    },
    repo,
    store as never,
    mainWindow as never,
    runtime as never,
    options?.earlyStartupSignal || options?.commitEarlyStartup
      ? {
          ...(options.earlyStartupSignal ? { earlyStartupSignal: options.earlyStartupSignal } : {}),
          ...(options.commitEarlyStartup ? { commitEarlyStartup: options.commitEarlyStartup } : {})
        }
      : undefined
  )
  return { result, mainWindow, repo, runtime, store }
}

export { mocks }
