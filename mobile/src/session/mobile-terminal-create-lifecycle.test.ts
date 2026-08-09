import { describe, expect, it, vi } from 'vitest'
import { MobileSessionTabIntentTracker } from './mobile-session-tab-intent-tracker'
import { finish, resetRoute } from './mobile-terminal-create-lifecycle'

describe('mobile terminal create lifecycle', () => {
  it('does not let an old route completion clear a newer create lock', () => {
    const tracker = new MobileSessionTabIntentTracker()
    const creatingRef = { current: true }
    const setCreating = vi.fn()
    const setCreateError = vi.fn()
    const state = [creatingRef, setCreating, setCreateError] as const
    tracker.worktreeId = 'worktree-a'
    const staleRevision = tracker.beginTerminalCreate()

    tracker.worktreeId = 'worktree-b'
    resetRoute(tracker, state)
    const currentRevision = tracker.beginTerminalCreate()
    creatingRef.current = true
    finish(() => tracker.isTerminalCreateCurrent('worktree-a', staleRevision), state)

    expect(creatingRef.current).toBe(true)
    finish(() => tracker.isTerminalCreateCurrent('worktree-b', currentRevision), state)
    expect(creatingRef.current).toBe(false)
  })
})
