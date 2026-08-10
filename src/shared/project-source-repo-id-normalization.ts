import type { Project } from './types'

function isProjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizePersistedProjectSourceRepoIds(projects: unknown): {
  projects: Project[]
  changed: boolean
} {
  if (!Array.isArray(projects)) {
    return { projects: [], changed: true }
  }

  let changed = false
  const normalizedProjects: Project[] = []
  for (const candidate of projects) {
    if (!isProjectRecord(candidate)) {
      changed = true
      continue
    }
    const project = candidate as Project
    const sourceRepoIds = candidate.sourceRepoIds
    if (
      Array.isArray(sourceRepoIds) &&
      sourceRepoIds.every((repoId) => typeof repoId === 'string')
    ) {
      normalizedProjects.push(project)
      continue
    }
    changed = true
    normalizedProjects.push({
      ...project,
      sourceRepoIds: Array.isArray(sourceRepoIds)
        ? sourceRepoIds.filter((repoId): repoId is string => typeof repoId === 'string')
        : []
    })
  }
  return { projects: normalizedProjects, changed }
}
