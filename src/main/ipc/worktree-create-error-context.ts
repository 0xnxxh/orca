import { isFolderRepo } from '../../shared/repo-kind'
import type { Repo } from '../../shared/repo-types'

/** Which of the three create implementations a repo routes to. */
export type WorktreeCreateRoute = 'folder' | 'remote' | 'local'

export function resolveWorktreeCreateRoute(
  repo: Pick<Repo, 'kind' | 'connectionId'>
): WorktreeCreateRoute {
  if (isFolderRepo(repo)) {
    return 'folder'
  }
  return repo.connectionId ? 'remote' : 'local'
}

/** Node fs errors carry a syscall and the path it was attempted on. */
function localFilesystemFailure(error: unknown): { code: string; syscall?: string } | null {
  if (!(error instanceof Error) || !('code' in error)) {
    return null
  }
  const candidate = error as NodeJS.ErrnoException
  if (candidate.code !== 'ENOENT' && candidate.code !== 'EACCES' && candidate.code !== 'EPERM') {
    return null
  }
  return {
    code: candidate.code,
    ...(candidate.syscall ? { syscall: candidate.syscall } : {})
  }
}

/**
 * Name the route when a raw filesystem error escapes worktree creation.
 *
 * A bare `ENOENT: no such file or directory, lstat '/home/user/...'` tells a user nothing and told
 * us almost nothing: an lstat is Node's LOCAL filesystem, so seeing one against a path that lives on
 * an SSH host means creation ran the local implementation for a remote repo. Which of the three
 * routes was taken, and why, is the whole diagnosis — and it is knowable exactly here, where the
 * routing decision was just made.
 *
 * Deliberately additive: the original error stays the cause, so nothing that matches on `code` or
 * inspects the stack changes behaviour. This only replaces an opaque message with one that says
 * which implementation ran and what the repo looked like when it was chosen.
 */
export function describeWorktreeCreateFailure(
  error: unknown,
  repo: Pick<Repo, 'kind' | 'connectionId' | 'path'>
): unknown {
  const failure = localFilesystemFailure(error)
  if (!failure) {
    return error
  }
  const route = resolveWorktreeCreateRoute(repo)
  // A remote route failing on local fs is the contradiction worth stating outright; the other routes
  // still benefit from naming themselves, because "which one ran" is the first question either way.
  const summary =
    route === 'remote'
      ? 'the remote (SSH) path failed on a local filesystem call'
      : `the ${route} path ran a local filesystem call`
  const described = new Error(
    `Workspace creation failed: ${summary} (${failure.code}${
      failure.syscall ? ` on ${failure.syscall}` : ''
    }). Repo kind=${repo.kind ?? 'git'}, connection=${repo.connectionId ?? 'none'}, path=${repo.path}. Original: ${
      error instanceof Error ? error.message : String(error)
    }`,
    { cause: error }
  )
  return described
}
