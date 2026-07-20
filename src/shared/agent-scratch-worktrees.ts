import { normalizeRuntimePathSeparators } from './cross-platform-path'

/** Why: coding-agent CLIs create throwaway sub-agent worktrees at fixed
 *  tool-internal paths (#9388); these are session scratch, never user
 *  workspaces. Curated exact segments — a generic dot-directory rule would
 *  swallow legitimate layouts like `<repo>/.worktrees/<branch>`. */
const AGENT_SCRATCH_PATH_SEGMENT_RUNS: readonly (readonly string[])[] = [
  ['.claude', 'worktrees'],
  ['.gsd-workspaces']
]

export function isAgentScratchWorktreePath(worktreePath: string): boolean {
  const segments = normalizeRuntimePathSeparators(worktreePath)
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.toLowerCase())
  return AGENT_SCRATCH_PATH_SEGMENT_RUNS.some((run) => hasSegmentRun(segments, run))
}

function hasSegmentRun(segments: readonly string[], run: readonly string[]): boolean {
  for (let start = 0; start + run.length <= segments.length; start++) {
    if (run.every((segment, offset) => segments[start + offset] === segment)) {
      return true
    }
  }
  return false
}
