import type { Project } from './types'

export function normalizePersistedProjectSourceRepoIds(projects: readonly Project[]): {
  projects: Project[]
  changed: boolean
} {
  let changed = false
  const normalizedProjects = projects.map((project) => {
    if (
      Array.isArray(project.sourceRepoIds) &&
      project.sourceRepoIds.every((repoId) => typeof repoId === 'string')
    ) {
      return project
    }
    changed = true
    return {
      ...project,
      sourceRepoIds: Array.isArray(project.sourceRepoIds)
        ? project.sourceRepoIds.filter((repoId): repoId is string => typeof repoId === 'string')
        : []
    }
  })
  return { projects: normalizedProjects, changed }
}
