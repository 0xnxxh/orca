import type { GitRuntimeOptions } from './git-runtime-options'
import { gitOptionsForWorktree } from './git-runtime-options'
import { gitExecFileAsync } from './runner'
import {
  encodeGitCheckIgnorePaths,
  GIT_CHECK_IGNORE_STDIN_ARGS,
  GIT_CHECK_IGNORE_TIMEOUT_MS,
  parseGitCheckIgnorePaths,
  splitGitCheckIgnorePathsByStdinBytes
} from '../../shared/git-check-ignore-stdio'

type GitExecError = Error & { stdout?: string; code?: number | string }

async function runCheckIgnoredPaths(
  worktreePath: string,
  relativePaths: string[],
  options: GitRuntimeOptions,
  timeoutMs: number
): Promise<string[]> {
  try {
    const { stdout } = await gitExecFileAsync([...GIT_CHECK_IGNORE_STDIN_ARGS], {
      ...gitOptionsForWorktree(worktreePath, options),
      stdin: encodeGitCheckIgnorePaths(relativePaths),
      timeout: timeoutMs
    })
    return parseGitCheckIgnorePaths(stdout)
  } catch (error) {
    const gitError = error as GitExecError
    if (gitError.code === 1) {
      return parseGitCheckIgnorePaths(gitError.stdout ?? '')
    }
    throw error
  }
}

export async function checkIgnoredPaths(
  worktreePath: string,
  relativePaths: string[],
  options: GitRuntimeOptions = {},
  timeoutMs: number = GIT_CHECK_IGNORE_TIMEOUT_MS
): Promise<string[]> {
  if (relativePaths.length === 0) {
    return []
  }
  const ignored = new Set<string>()
  for (const chunk of splitGitCheckIgnorePathsByStdinBytes(relativePaths)) {
    for (const ignoredPath of await runCheckIgnoredPaths(worktreePath, chunk, options, timeoutMs)) {
      ignored.add(ignoredPath)
    }
  }
  return Array.from(ignored)
}
