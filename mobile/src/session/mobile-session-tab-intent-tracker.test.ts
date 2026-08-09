import { describe, expect, it } from 'vitest'
import { MobileSessionTabIntentTracker } from './mobile-session-tab-intent-tracker'

describe('MobileSessionTabIntentTracker', () => {
  it('invalidates every delayed focus path when a newer intent arrives', () => {
    const tracker = new MobileSessionTabIntentTracker()
    const firstRevision = tracker.supersede()
    const retryWhileFirstIsCurrent = tracker.retryWhileCurrent(firstRevision)
    tracker.pendingFocusKey = 'browser:page-1'

    expect(retryWhileFirstIsCurrent()).toBe(true)

    const secondRevision = tracker.supersede()

    expect(secondRevision).toBeGreaterThan(firstRevision)
    expect(tracker.fileTapActivationSeq).toBe(secondRevision)
    expect(tracker.diffActivationSeq).toBe(secondRevision)
    expect(tracker.pendingFocusKey).toBeNull()
    expect(retryWhileFirstIsCurrent()).toBe(false)
  })

  it('keeps an old route create from owning a reused route identity', () => {
    const tracker = new MobileSessionTabIntentTracker()
    tracker.worktreeId = 'worktree-a'
    const staleCreate = tracker.beginTerminalCreate()

    tracker.worktreeId = 'worktree-b'
    tracker.invalidateTerminalCreate()
    const currentCreate = tracker.beginTerminalCreate()
    tracker.worktreeId = 'worktree-a'
    tracker.invalidateTerminalCreate()

    expect(tracker.isTerminalCreateCurrent('worktree-a', staleCreate)).toBe(false)
    expect(tracker.isTerminalCreateCurrent('worktree-b', currentCreate)).toBe(false)
    expect(tracker.isTerminalCreateCurrent('worktree-a', tracker.beginTerminalCreate())).toBe(true)
  })
})
