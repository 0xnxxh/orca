import { afterEach, describe, expect, it } from 'vitest'
import {
  __activeEditorPathMoveCountForTests,
  __clearEditorPathMovesForTests,
  beginEditorPathMove,
  isActiveMoveSourcePath,
  noteEditorPathMoveDestinationEvent,
  settleEditorPathMove
} from './editor-path-move-inflight'

describe('editor-path-move-inflight', () => {
  afterEach(() => __clearEditorPathMovesForTests())

  it('marks a source path active only while the operation is in flight', () => {
    beginEditorPathMove({
      operationId: 'op-1',
      worktreeId: 'wt-1',
      runtimeEnvironmentId: null,
      sourcePaths: ['/repo/a.md'],
      targetPaths: ['/repo/sub/a.md']
    })
    expect(isActiveMoveSourcePath('wt-1', null, '/repo/a.md')).toBe(true)

    settleEditorPathMove('op-1')
    expect(isActiveMoveSourcePath('wt-1', null, '/repo/a.md')).toBe(false)
    expect(__activeEditorPathMoveCountForTests()).toBe(0)
  })

  it('scopes by worktree and runtime owner', () => {
    beginEditorPathMove({
      operationId: 'op-1',
      worktreeId: 'wt-1',
      runtimeEnvironmentId: 'env-1',
      sourcePaths: ['/repo/a.md'],
      targetPaths: []
    })
    expect(isActiveMoveSourcePath('wt-1', 'env-1', '/repo/a.md')).toBe(true)
    expect(isActiveMoveSourcePath('wt-1', null, '/repo/a.md')).toBe(false)
    expect(isActiveMoveSourcePath('wt-2', 'env-1', '/repo/a.md')).toBe(false)
  })

  it('latches destination events and returns them on settle', () => {
    beginEditorPathMove({
      operationId: 'op-1',
      worktreeId: 'wt-1',
      runtimeEnvironmentId: null,
      sourcePaths: ['/repo/a.md'],
      targetPaths: ['/repo/sub/a.md']
    })
    // A destination event that arrives before the rekey is latched, not lost.
    expect(noteEditorPathMoveDestinationEvent('wt-1', null, '/repo/sub/a.md')).toBe(true)
    expect(noteEditorPathMoveDestinationEvent('wt-1', null, '/repo/other.md')).toBe(false)

    const latched = settleEditorPathMove('op-1')
    expect(latched).toEqual(['/repo/sub/a.md'.toLowerCase()])
  })

  it('keeps concurrent operations independent (settling one leaves the other)', () => {
    beginEditorPathMove({
      operationId: 'op-1',
      worktreeId: 'wt-1',
      runtimeEnvironmentId: null,
      sourcePaths: ['/repo/a.md'],
      targetPaths: []
    })
    beginEditorPathMove({
      operationId: 'op-2',
      worktreeId: 'wt-1',
      runtimeEnvironmentId: null,
      sourcePaths: ['/repo/b.md'],
      targetPaths: []
    })

    settleEditorPathMove('op-1')
    expect(isActiveMoveSourcePath('wt-1', null, '/repo/a.md')).toBe(false)
    expect(isActiveMoveSourcePath('wt-1', null, '/repo/b.md')).toBe(true)
  })
})
