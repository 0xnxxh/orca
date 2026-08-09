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
    const staleCreate = tracker.beginTabCreate('terminal')

    tracker.worktreeId = 'worktree-b'
    tracker.invalidateTabCreates()
    const currentCreate = tracker.beginTabCreate('terminal')
    tracker.worktreeId = 'worktree-a'
    tracker.invalidateTabCreates()

    expect(tracker.isTabCreateCurrent('worktree-a', 'terminal', staleCreate)).toBe(false)
    expect(tracker.isTabCreateCurrent('worktree-b', 'terminal', currentCreate)).toBe(false)
    expect(
      tracker.isTabCreateCurrent('worktree-a', 'terminal', tracker.beginTabCreate('terminal'))
    ).toBe(true)
  })

  it('invalidates every create kind on a route change', () => {
    const tracker = new MobileSessionTabIntentTracker()
    tracker.worktreeId = 'worktree-a'
    const revisions = {
      terminal: tracker.beginTabCreate('terminal'),
      browser: tracker.beginTabCreate('browser'),
      markdown: tracker.beginTabCreate('markdown')
    }

    tracker.invalidateTabCreates()

    expect(tracker.isTabCreateCurrent('worktree-a', 'terminal', revisions.terminal)).toBe(false)
    expect(tracker.isTabCreateCurrent('worktree-a', 'browser', revisions.browser)).toBe(false)
    expect(tracker.isTabCreateCurrent('worktree-a', 'markdown', revisions.markdown)).toBe(false)
  })
})
