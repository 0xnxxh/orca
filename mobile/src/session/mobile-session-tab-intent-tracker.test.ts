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
})
