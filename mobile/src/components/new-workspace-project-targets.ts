import type { Repo } from '../../../src/shared/types'
import { getRepoExecutionHostId } from '../../../src/shared/execution-host'
import { getProjectIdentityKey } from '../../../src/shared/project-host-setup-projection'

type WorkspaceRepo = Pick<Repo, 'id' | 'displayName' | 'path'> &
  Partial<
    Pick<Repo, 'connectionId' | 'executionHostId' | 'upstream' | 'repoIcon' | 'gitRemoteIdentity'>
  >

export type NewWorkspaceProjectOption<TRepo extends WorkspaceRepo> = {
  id: string
  label: string
  detail?: string
  repo: TRepo
}

export type NewWorkspaceRunTargetOption<TRepo extends WorkspaceRepo> = {
  id: string
  label: string
  detail: string
  repo: TRepo
}

function executionHostName(executionHostId: string): string {
  const encodedName = executionHostId.slice(executionHostId.indexOf(':') + 1)
  try {
    return decodeURIComponent(encodedName)
  } catch {
    return encodedName
  }
}

export function getNewWorkspaceProjectId(repo: WorkspaceRepo): string {
  return getProjectIdentityKey(repo)
}

export function buildNewWorkspaceProjectOptions<TRepo extends WorkspaceRepo>(
  repos: readonly TRepo[]
): NewWorkspaceProjectOption<TRepo>[] {
  const options = new Map<string, NewWorkspaceProjectOption<TRepo>>()
  const hostIdsByProject = new Map<string, Set<string>>()
  for (const repo of repos) {
    const id = getNewWorkspaceProjectId(repo)
    const hostIds = hostIdsByProject.get(id) ?? new Set<string>()
    hostIds.add(getRepoExecutionHostId(repo))
    hostIdsByProject.set(id, hostIds)
    if (!options.has(id)) {
      options.set(id, {
        id,
        label: repo.displayName,
        repo
      })
    }
  }
  return [...options.values()].map((option) => {
    const providerParts = option.id.startsWith('github:')
      ? option.id.slice('github:'.length).split('/')
      : []
    const providerDetail = providerParts.slice(-2).join('/')
    const hostCount = hostIdsByProject.get(option.id)?.size ?? 0
    const detail = providerDetail || (hostCount > 1 ? `${hostCount} hosts configured` : '')
    return detail ? { ...option, detail } : option
  })
}

export function getNewWorkspaceRunTarget(repo: WorkspaceRepo): {
  label: string
  detail: string
} {
  const connectionId = repo.connectionId?.trim()
  if (connectionId) {
    return { label: `SSH · ${connectionId}`, detail: repo.path }
  }
  if (repo.executionHostId?.startsWith('ssh:')) {
    return { label: `SSH · ${executionHostName(repo.executionHostId)}`, detail: repo.path }
  }
  if (repo.executionHostId?.startsWith('runtime:')) {
    return { label: `Remote · ${executionHostName(repo.executionHostId)}`, detail: repo.path }
  }
  return { label: 'Local Mac', detail: repo.path }
}

export function buildNewWorkspaceRunTargetOptions<TRepo extends WorkspaceRepo>(
  repos: readonly TRepo[],
  projectId: string | null
): NewWorkspaceRunTargetOption<TRepo>[] {
  if (!projectId) {
    return []
  }
  const options = new Map<string, NewWorkspaceRunTargetOption<TRepo>>()
  for (const repo of repos) {
    if (getNewWorkspaceProjectId(repo) !== projectId) {
      continue
    }
    const hostId = getRepoExecutionHostId(repo)
    if (!options.has(hostId)) {
      options.set(hostId, { id: repo.id, ...getNewWorkspaceRunTarget(repo), repo })
    }
  }
  return [...options.values()]
}
