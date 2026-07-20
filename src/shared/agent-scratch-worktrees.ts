import { isWindowsAbsolutePathLike, relativePathInsideRoot } from './cross-platform-path'
import { isWslUncPath } from './wsl-paths'

/** Why: agent CLIs reserve these repo-root paths for scratch; broader matches
 *  can hide legitimate user worktrees (#9388). */
const AGENT_SCRATCH_PATH_PREFIXES: readonly (readonly string[])[] = [
  ['.claude', 'worktrees'],
  ['.gsd-workspaces']
]

export function isAgentScratchWorktreePath(repoPath: string, worktreePath: string): boolean {
  const relativePath = relativePathInsideRoot(repoPath, worktreePath)
  if (!relativePath) {
    return false
  }
  const caseInsensitive = isWindowsAbsolutePathLike(worktreePath) && !isWslUncPath(worktreePath)
  const segments = relativePath
    .split('/')
    .filter(Boolean)
    .map((segment) => (caseInsensitive ? segment.toLowerCase() : segment))
  return AGENT_SCRATCH_PATH_PREFIXES.some(
    (prefix) =>
      segments.length > prefix.length &&
      prefix.every((segment, index) => segments[index] === segment)
  )
}
