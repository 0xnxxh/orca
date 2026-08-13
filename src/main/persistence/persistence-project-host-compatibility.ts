import type { PersistedState, ProjectHostSetup, Repo } from '../../shared/types'
import type { ExecutionHostId } from '../../shared/execution-host'
import { projectHostSetupProjectionFromRepos } from '../../shared/project-host-setup-projection'

export function projectHostSetupCompatibilityStateEqual(
  state: Pick<PersistedState, 'projects' | 'projectHostSetups'>,
  nextState: Pick<PersistedState, 'projects' | 'projectHostSetups'>
): boolean {
  return (
    JSON.stringify(state.projects ?? []) === JSON.stringify(nextState.projects) &&
    JSON.stringify(state.projectHostSetups ?? []) === JSON.stringify(nextState.projectHostSetups)
  )
}

export function isRepoBackedProjectHostSetup(
  setup: ProjectHostSetup,
  currentRepoIds: ReadonlySet<string>
): boolean {
  const repoId = typeof setup.repoId === 'string' ? setup.repoId : ''
  return repoId.length > 0 && (currentRepoIds.has(repoId) || setup.id === repoId)
}

export function mergeProjectHostSetupCompatibilityState(
  state: Pick<PersistedState, 'projects' | 'projectHostSetups'>,
  repos: readonly Repo[]
): Pick<PersistedState, 'projects' | 'projectHostSetups'> {
  const projection = projectHostSetupProjectionFromRepos(repos)
  const existingProjectsById = new Map(
    (state.projects ?? []).map((project) => [project.id, project])
  )
  const currentRepoIds = new Set(repos.map((repo) => repo.id))
  const projectedProjectIds = new Set(projection.projects.map((project) => project.id))
  const projectedSetupIds = new Set(projection.setups.map((setup) => setup.id))
  // Why: legacy/repo-backed setup rows reuse the repo id; keep only independent rows so repo deletion leaves no ghosts.
  const independentSetups = (state.projectHostSetups ?? []).filter((setup) => {
    if (projectedSetupIds.has(setup.id)) {
      return false
    }
    return !isRepoBackedProjectHostSetup(setup, currentRepoIds)
  })
  const independentProjectIds = new Set(independentSetups.map((setup) => setup.projectId))
  const independentProjects = (state.projects ?? [])
    .filter(
      (project) => independentProjectIds.has(project.id) && !projectedProjectIds.has(project.id)
    )
    .map((project) => ({
      ...project,
      sourceRepoIds: project.sourceRepoIds.filter((repoId) => currentRepoIds.has(repoId))
    }))
  const projectedProjects = projection.projects.map((project) => {
    const existingProject = existingProjectsById.get(project.id)
    return existingProject?.localWindowsRuntimePreference
      ? {
          ...project,
          localWindowsRuntimePreference: existingProject.localWindowsRuntimePreference,
          updatedAt: Math.max(project.updatedAt, existingProject.updatedAt)
        }
      : project
  })
  return {
    projects: [...projectedProjects, ...independentProjects],
    projectHostSetups: [...projection.setups, ...independentSetups]
  }
}

export function makeProjectHostSetupId(
  projectId: string,
  hostId: ExecutionHostId,
  existingIds: ReadonlySet<string>,
  requestedId?: string
): string {
  const baseId = requestedId?.trim() || `${projectId}::${hostId}`
  if (!existingIds.has(baseId)) {
    return baseId
  }
  let suffix = 2
  let candidate = `${baseId}::${suffix}`
  while (existingIds.has(candidate)) {
    suffix++
    candidate = `${baseId}::${suffix}`
  }
  return candidate
}
