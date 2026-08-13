import type { Repo } from '../../shared/types'
import { getDefaultRepoHookSettings } from '../../shared/constants'
import { isFolderRepo } from '../../shared/repo-kind'
import { sanitizeRepoIcon } from '../../shared/repo-icon'
import { normalizeRepoSourceControlAiOverrides } from '../../shared/source-control-ai'
import {
  sanitizeForkSyncMode,
  sanitizeGitRemoteIdentity,
  sanitizeRepoProjectHostSetupMethod,
  sanitizeRepoUpstream
} from './persistence-repo-sanitization'

export function hydrateRepo(repo: Repo, gitUsernameCache: ReadonlyMap<string, string>): Repo {
  const {
    repoIcon: rawRepoIcon,
    upstream: rawUpstream,
    gitRemoteIdentity: rawGitRemoteIdentity,
    sourceControlAi: rawSourceControlAi,
    projectHostSetupMethod: rawProjectHostSetupMethod,
    forkSyncMode: rawForkSyncMode,
    ...repoWithoutIcon
  } = repo
  const repoIcon = sanitizeRepoIcon(rawRepoIcon)
  const upstream = sanitizeRepoUpstream(rawUpstream)
  const gitRemoteIdentity = sanitizeGitRemoteIdentity(rawGitRemoteIdentity)
  const sourceControlAi = normalizeRepoSourceControlAiOverrides(rawSourceControlAi)
  const projectHostSetupMethod = sanitizeRepoProjectHostSetupMethod(rawProjectHostSetupMethod)
  const forkSyncMode = sanitizeForkSyncMode(rawForkSyncMode)
  // Why: never spawn git/gh username resolution in hydration — a stuck probe froze Windows startup for minutes (issue #7225); read only cache/persisted value.
  const gitUsername = isFolderRepo(repo)
    ? ''
    : (gitUsernameCache.get(repo.path) ?? repo.gitUsername ?? '')

  return {
    ...repoWithoutIcon,
    ...(repoIcon !== undefined ? { repoIcon } : {}),
    ...(upstream !== undefined ? { upstream } : {}),
    ...(gitRemoteIdentity !== undefined ? { gitRemoteIdentity } : {}),
    ...(sourceControlAi !== undefined ? { sourceControlAi } : {}),
    ...(projectHostSetupMethod !== undefined ? { projectHostSetupMethod } : {}),
    ...(forkSyncMode !== undefined ? { forkSyncMode } : {}),
    kind: isFolderRepo(repo) ? 'folder' : 'git',
    gitUsername,
    hookSettings: {
      ...getDefaultRepoHookSettings(),
      ...repo.hookSettings,
      scripts: {
        ...getDefaultRepoHookSettings().scripts,
        ...repo.hookSettings?.scripts
      }
    }
  }
}
