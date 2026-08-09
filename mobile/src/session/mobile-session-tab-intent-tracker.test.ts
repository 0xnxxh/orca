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
    tracker.hostId = 'host-a'
    tracker.worktreeId = 'worktree-a'
    const staleCreate = tracker.beginTabCreate('terminal')

    tracker.worktreeId = 'worktree-b'
    tracker.invalidateTabCreates()
    const currentCreate = tracker.beginTabCreate('terminal')
    tracker.worktreeId = 'worktree-a'
    tracker.invalidateTabCreates()

    expect(tracker.isTabCreateCurrent('host-a', 'worktree-a', 'terminal', staleCreate)).toBe(false)
    expect(tracker.isTabCreateCurrent('host-a', 'worktree-b', 'terminal', currentCreate)).toBe(
      false
    )
    expect(
      tracker.isTabCreateCurrent(
        'host-a',
        'worktree-a',
        'terminal',
        tracker.beginTabCreate('terminal')
      )
    ).toBe(true)
  })

  it('invalidates every create kind on a route change', () => {
    const tracker = new MobileSessionTabIntentTracker()
    tracker.hostId = 'host-a'
    tracker.worktreeId = 'worktree-a'
    const revisions = {
      terminal: tracker.beginTabCreate('terminal'),
      browser: tracker.beginTabCreate('browser'),
      markdown: tracker.beginTabCreate('markdown')
    }

    tracker.invalidateTabCreates()

    expect(tracker.isTabCreateCurrent('host-a', 'worktree-a', 'terminal', revisions.terminal)).toBe(
      false
    )
    expect(tracker.isTabCreateCurrent('host-a', 'worktree-a', 'browser', revisions.browser)).toBe(
      false
    )
    expect(tracker.isTabCreateCurrent('host-a', 'worktree-a', 'markdown', revisions.markdown)).toBe(
      false
    )
  })

  it('changes route identity when only the host changes', () => {
    const tracker = new MobileSessionTabIntentTracker()
    tracker.setRoute('host-a', 'global-floating-terminal')
    const retryWhileCurrent = tracker.retryWhileCurrent(tracker.revision)
    const pendingActivationKey = tracker.pendingActivationKey({ id: 'tab-1' })

    expect(tracker.isRouteCurrent('host-a', 'global-floating-terminal')).toBe(true)
    expect(tracker.isRouteCurrent('host-b', 'global-floating-terminal')).toBe(false)

    tracker.setRoute('host-b', 'global-floating-terminal')

    expect(retryWhileCurrent()).toBe(false)
    expect(tracker.pendingActivationKey({ id: 'tab-1' })).not.toBe(pendingActivationKey)
    expect(tracker.isRouteCurrent('host-b', 'global-floating-terminal')).toBe(true)
  })

  it('does not let a delayed route completion own a revisited route', () => {
    const tracker = new MobileSessionTabIntentTracker()
    tracker.setRoute('host-a', 'worktree-a')
    const ownsFirstVisit = tracker.captureRouteOwnership('host-a', 'worktree-a')

    tracker.setRoute('host-b', 'worktree-b')
    tracker.setRoute('host-a', 'worktree-a')

    expect(ownsFirstVisit()).toBe(false)
    expect(tracker.captureRouteOwnership('host-a', 'worktree-a')()).toBe(true)
  })

  it('supersedes an older document read without cancelling other tabs', () => {
    const tracker = new MobileSessionTabIntentTracker()
    const firstA = tracker.beginDocumentRead('tab-a')
    const firstB = tracker.beginDocumentRead('tab-b')

    const secondA = tracker.beginDocumentRead('tab-a')

    expect(firstA()).toBe(false)
    expect(secondA()).toBe(true)
    expect(firstB()).toBe(true)
  })

  it('invalidates document reads on route reuse', () => {
    const tracker = new MobileSessionTabIntentTracker()
    tracker.setRoute('host-a', 'worktree-a')
    const stale = tracker.beginDocumentRead('tab-a')
    const staleSave = tracker.beginMarkdownSave('tab-a')

    tracker.setRoute('host-b', 'worktree-b')
    tracker.setRoute('host-a', 'worktree-a')

    expect(stale()).toBe(false)
    expect(staleSave()).toBe(false)
    expect(tracker.beginDocumentRead('tab-a')()).toBe(true)
  })

  it('invalidates retired document operations without cancelling other tabs', () => {
    const tracker = new MobileSessionTabIntentTracker()
    const retiredRead = tracker.beginDocumentRead('tab-a')
    const retainedRead = tracker.beginDocumentRead('tab-b')
    const retiredSave = tracker.beginMarkdownSave('tab-a')
    const retainedSave = tracker.beginMarkdownSave('tab-b')

    tracker.invalidateDocumentOperations(['tab-a'])

    expect(retiredRead()).toBe(false)
    expect(retiredSave()).toBe(false)
    expect(retainedRead()).toBe(true)
    expect(retainedSave()).toBe(true)
    expect(tracker.beginMarkdownSave('tab-a')()).toBe(true)
  })

  it('invalidates changed document reads without cancelling saves', () => {
    const tracker = new MobileSessionTabIntentTracker()
    const staleRead = tracker.beginDocumentRead('tab-a')
    const currentSave = tracker.beginMarkdownSave('tab-a')

    tracker.invalidateDocumentReads(['tab-a'])

    expect(staleRead()).toBe(false)
    expect(currentSave()).toBe(true)
  })
})
