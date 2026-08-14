type RepoLocation = {
  path: string
  connectionId?: string | null
  executionHostId?: 'local' | `ssh:${string}` | `runtime:${string}` | null
}

function executionHostName(executionHostId: string): string | null {
  const encodedName = executionHostId.slice(executionHostId.indexOf(':') + 1)
  if (!encodedName) {
    return null
  }
  try {
    return decodeURIComponent(encodedName) || null
  } catch {
    return null
  }
}

export function getNewWorkspaceRepoDetail(repo: RepoLocation): string {
  const executionHostId = repo.executionHostId?.trim()
  if (executionHostId === 'local') {
    return `Local · ${repo.path}`
  }
  if (executionHostId?.startsWith('ssh:')) {
    const hostName = executionHostName(executionHostId)
    if (hostName) {
      return `SSH · ${hostName} · ${repo.path}`
    }
  }
  if (executionHostId?.startsWith('runtime:')) {
    const hostName = executionHostName(executionHostId)
    if (hostName) {
      return `Remote · ${hostName} · ${repo.path}`
    }
  }
  const connectionId = repo.connectionId?.trim()
  if (connectionId) {
    return `SSH · ${connectionId} · ${repo.path}`
  }
  return `Local · ${repo.path}`
}
