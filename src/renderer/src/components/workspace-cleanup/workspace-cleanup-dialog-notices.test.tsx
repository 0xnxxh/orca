// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceCleanupInitialScanBanner } from './workspace-cleanup-dialog-notices'

afterEach(cleanup)

describe('WorkspaceCleanupInitialScanBanner', () => {
  it('puts determinate progress in the title with matching typography', () => {
    render(
      <WorkspaceCleanupInitialScanBanner
        progress={{
          scanId: 'scan-1',
          scannedAt: 1,
          scannedWorktreeCount: 23,
          totalWorktreeCount: 3048,
          candidates: [],
          errors: []
        }}
      />
    )

    expect(screen.getByText('Scanning workspaces (23/3048)')).toBeTruthy()
    expect(screen.queryByText('Checked workspaces so far: 23')).toBeNull()
  })
})
