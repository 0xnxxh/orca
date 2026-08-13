import type { PersistedState, Repo } from '../../shared/types'
import type { ExecutionHostId } from '../../shared/execution-host'
import { getRepoExecutionHostId } from '../../shared/execution-host'
import { isLegacyRepoForExternalWorktreeVisibility } from '../../shared/worktree-ownership'
import { normalizeRepoSourceControlAiOverrides } from '../../shared/source-control-ai'
import { sanitizeRepoUpdatesForPersistence } from './persistence-repo-sanitization'

export type RepoUpdateMutationOperations = {
  state: PersistedState
  syncProjectHostSetupCompatibilityState: () => void
  scheduleSave: () => void
  hydrateRepo: (repo: Repo) => Repo
}

export class RepoUpdatePersistenceOperations {
  constructor(private readonly operations: RepoUpdateMutationOperations) {}

  private get state(): PersistedState {
    return this.operations.state
  }

  private syncProjectHostSetupCompatibilityState(): void {
    this.operations.syncProjectHostSetupCompatibilityState()
  }

  private scheduleSave(): void {
    this.operations.scheduleSave()
  }

  private hydrateRepo(repo: Repo): Repo {
    return this.operations.hydrateRepo(repo)
  }

  updateRepo(
    id: string,
    updates: Partial<
      Pick<
        Repo,
        | 'displayName'
        | 'badgeColor'
        | 'repoIcon'
        | 'upstream'
        | 'gitRemoteIdentity'
        | 'hookSettings'
        | 'worktreeBaseRef'
        | 'worktreeBasePath'
        | 'kind'
        | 'executionHostId'
        | 'symlinkPaths'
        | 'issueSourcePreference'
        | 'forkSyncMode'
        | 'externalWorktreeVisibility'
        | 'externalWorktreeVisibilityPromptDismissedAt'
        | 'externalWorktreeInboxBaselinePaths'
        | 'importedExternalWorktreePaths'
        | 'agentWorktreeVisibility'
        | 'projectGroupId'
        | 'projectGroupOrder'
        | 'projectHostSetupMethod'
      >
    > & {
      sourceControlAi?: Repo['sourceControlAi'] | null
      externalWorktreeDiscoverySuppressedAt?: Repo['externalWorktreeDiscoverySuppressedAt'] | null
    },
    hostId?: ExecutionHostId
  ): Repo | null {
    const repo = this.state.repos.find(
      (candidate) =>
        candidate.id === id && (!hostId || getRepoExecutionHostId(candidate) === hostId)
    )
    if (!repo) {
      return null
    }
    const sanitizedUpdates = sanitizeRepoUpdatesForPersistence(updates)
    if ('projectGroupId' in sanitizedUpdates) {
      const nextGroupId = sanitizedUpdates.projectGroupId
      if (
        typeof nextGroupId !== 'string' ||
        nextGroupId.trim().length === 0 ||
        !this.state.projectGroups.some((group) => group.id === nextGroupId)
      ) {
        sanitizedUpdates.projectGroupId = null
      }
    }
    if (
      'projectGroupOrder' in sanitizedUpdates &&
      (typeof sanitizedUpdates.projectGroupOrder !== 'number' ||
        !Number.isFinite(sanitizedUpdates.projectGroupOrder))
    ) {
      delete sanitizedUpdates.projectGroupOrder
    }
    const externalWorktreeVisibilityLegacy =
      'externalWorktreeVisibility' in sanitizedUpdates &&
      repo.externalWorktreeVisibilityLegacy === undefined
        ? isLegacyRepoForExternalWorktreeVisibility(repo)
        : undefined
    // Why: selected repo fields use `undefined` as an explicit clear signal, so delete them before assigning the patch.
    if (
      'issueSourcePreference' in sanitizedUpdates &&
      sanitizedUpdates.issueSourcePreference === undefined
    ) {
      delete repo.issueSourcePreference
      delete sanitizedUpdates.issueSourcePreference
    }
    if ('worktreeBasePath' in sanitizedUpdates && sanitizedUpdates.worktreeBasePath === undefined) {
      delete repo.worktreeBasePath
      delete sanitizedUpdates.worktreeBasePath
    }
    if (
      'externalWorktreeVisibility' in sanitizedUpdates &&
      (sanitizedUpdates.externalWorktreeVisibility === undefined ||
        sanitizedUpdates.externalWorktreeVisibility === null)
    ) {
      delete repo.externalWorktreeVisibility
      repo.externalWorktreeVisibilityLegacy = false
      delete sanitizedUpdates.externalWorktreeVisibility
    }
    if (
      'agentWorktreeVisibility' in sanitizedUpdates &&
      sanitizedUpdates.agentWorktreeVisibility === null
    ) {
      delete repo.agentWorktreeVisibility
      delete sanitizedUpdates.agentWorktreeVisibility
    }
    if (
      'externalWorktreeVisibility' in sanitizedUpdates &&
      repo.externalWorktreeVisibilityLegacy === undefined
    ) {
      // Why: old persisted repos have no marker; stamp it on first visibility change so later hide/show keeps legacy safety.
      repo.externalWorktreeVisibilityLegacy = externalWorktreeVisibilityLegacy
    }
    if (
      'externalWorktreeDiscoverySuppressedAt' in sanitizedUpdates &&
      (sanitizedUpdates.externalWorktreeDiscoverySuppressedAt === undefined ||
        sanitizedUpdates.externalWorktreeDiscoverySuppressedAt === null)
    ) {
      delete repo.externalWorktreeDiscoverySuppressedAt
      delete sanitizedUpdates.externalWorktreeDiscoverySuppressedAt
    }
    if (
      'sourceControlAi' in sanitizedUpdates &&
      (sanitizedUpdates.sourceControlAi === undefined || sanitizedUpdates.sourceControlAi === null)
    ) {
      delete repo.sourceControlAi
      delete sanitizedUpdates.sourceControlAi
    } else if ('sourceControlAi' in sanitizedUpdates) {
      const normalizedSourceControlAi = normalizeRepoSourceControlAiOverrides(
        sanitizedUpdates.sourceControlAi
      )
      if (normalizedSourceControlAi === undefined) {
        delete sanitizedUpdates.sourceControlAi
      } else {
        sanitizedUpdates.sourceControlAi = normalizedSourceControlAi
      }
    }
    Object.assign(repo, sanitizedUpdates)
    this.syncProjectHostSetupCompatibilityState()
    this.scheduleSave()
    return this.hydrateRepo(repo)
  }
}
