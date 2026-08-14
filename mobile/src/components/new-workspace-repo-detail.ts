type RepoLocation = {
  path: string
  connectionId?: string | null
  executionHostId?: 'local' | `ssh:${string}` | `runtime:${string}` | null
}

function executionHostName(executionHostId: string): string {
  const encodedName = executionHostId.slice(executionHostId.indexOf(':') + 1)
  try {
    return decodeURIComponent(encodedName)
  } catch {
    return encodedName
  }
}

export function getNewWorkspaceRepoDetail(repo: RepoLocation): string {
  const connectionId = repo.connectionId?.trim()
  if (connectionId) {
    return `SSH · ${connectionId} · ${repo.path}`
  }
  if (repo.executionHostId?.startsWith('ssh:')) {
    return `SSH · ${executionHostName(repo.executionHostId)} · ${repo.path}`
  }
  if (repo.executionHostId?.startsWith('runtime:')) {
    return `Remote · ${executionHostName(repo.executionHostId)} · ${repo.path}`
  }
  return `Local · ${repo.path}`
}
