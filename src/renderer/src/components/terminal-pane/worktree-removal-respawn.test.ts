import { describe, expect, it } from 'vitest'
import { resolveWorktreeRemovalRespawnDecision } from './worktree-removal-respawn'

describe('resolveWorktreeRemovalRespawnDecision', () => {
  it('waits while this workspace is still being removed', () => {
    expect(resolveWorktreeRemovalRespawnDecision({ 'wt-1': { isDeleting: true } }, true)).toBe(
      'wait'
    )
  })

  // Why: an overlapping parent/child root removal fences this pane's spawn in main
  // even though the pane's own workspace carries no delete state.
  it('waits while any other workspace removal is in flight', () => {
    expect(resolveWorktreeRemovalRespawnDecision({ 'wt-parent': { isDeleting: true } }, true)).toBe(
      'wait'
    )
  })

  it('respawns once every removal settled and the workspace survived', () => {
    expect(resolveWorktreeRemovalRespawnDecision({ 'wt-1': { isDeleting: false } }, true)).toBe(
      'respawn'
    )
    expect(resolveWorktreeRemovalRespawnDecision({}, true)).toBe('respawn')
    expect(resolveWorktreeRemovalRespawnDecision(undefined, true)).toBe('respawn')
  })

  it('abandons when the workspace is gone', () => {
    expect(resolveWorktreeRemovalRespawnDecision({}, false)).toBe('abandon')
  })
})
