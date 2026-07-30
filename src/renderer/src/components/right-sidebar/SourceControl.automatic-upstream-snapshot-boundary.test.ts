import { describe, expect, it } from 'vitest'
import source from './SourceControl.tsx?raw'

describe('Source Control automatic upstream snapshot boundary', () => {
  it('uses snapshots only for the visible automatic load and keeps mutation refreshes fresh', () => {
    expect(source).toContain('useSourceControlAutomaticUpstreamSnapshot({')
    expect(source).toContain('enabled: isBranchVisible && !isFolder')
    expect(source).toContain('const refreshActiveGitStatusAfterMutation = useCallback')
    expect(source).toContain('await refreshActiveGitStatus()')
    expect(source).toContain('return await refreshGitStatusForWorktreeStrict({')
  })
})
