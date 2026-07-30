import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(join(__dirname, 'ChecksPanel.tsx'), 'utf8')

describe('ChecksPanel repository snapshot boundary', () => {
  it('uses runtime-owner snapshots only for automatic eligibility and keeps manual refresh fresh', () => {
    const automaticStart = SOURCE.indexOf('shouldCoalesceChecksPanelGitStatusSnapshotRefresh')
    const automaticEnd = SOURCE.indexOf('const handleRefresh = useCallback')
    const automatic = SOURCE.slice(automaticStart, automaticEnd)
    const manual = SOURCE.slice(automaticEnd, SOURCE.indexOf('const handleCancelRun', automaticEnd))

    expect(automatic).toContain('getChecksPanelRepositorySnapshot')
    expect(automatic).toContain('getRuntimeGitStatus')
    expect(automatic).toContain('getRuntimeGitUpstreamStatus')
    expect(manual).toContain('getRuntimeGitStatus')
    expect(manual).toContain('getRuntimeGitUpstreamStatus')
    expect(manual).not.toContain('getChecksPanelRepositorySnapshot')
  })
})
