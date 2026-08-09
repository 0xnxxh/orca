import { describe, expect, it, vi } from 'vitest'
import { MobileSessionTabIntentTracker } from './mobile-session-tab-intent-tracker'
import {
  bindRoute,
  finish,
  reportCaughtError,
  resetRoute
} from './mobile-session-tab-create-lifecycle'

describe('mobile session tab create lifecycle', () => {
  it.each(['terminal', 'browser', 'markdown'] as const)(
    'does not let an old route %s completion clear a newer create lock',
    (kind) => {
      const tracker = new MobileSessionTabIntentTracker()
      const creatingRef = { current: true }
      const setCreating = vi.fn()
      const setCreateError = vi.fn()
      const state = [creatingRef, setCreating, setCreateError] as const
      tracker.hostId = 'host-a'
      tracker.worktreeId = 'worktree-a'
      const staleOwnsCreate = bindRoute(tracker, 'host-a', 'worktree-a')(kind, state)

      tracker.hostId = 'host-b'
      tracker.worktreeId = 'worktree-b'
      resetRoute(tracker, [state])
      const currentOwnsCreate = bindRoute(tracker, 'host-b', 'worktree-b')(kind, state)
      finish(staleOwnsCreate, state)

      expect(creatingRef.current).toBe(true)
      finish(currentOwnsCreate, state)
      expect(creatingRef.current).toBe(false)
    }
  )

  it('rejects an old host completion before the route effect resets shared worktree state', () => {
    const tracker = new MobileSessionTabIntentTracker()
    const state = [{ current: false }, vi.fn(), vi.fn()] as const
    tracker.hostId = 'host-a'
    tracker.worktreeId = 'global-floating-terminal'
    const ownsCreate = bindRoute(tracker, 'host-a', 'global-floating-terminal')('terminal', state)

    tracker.hostId = 'host-b'

    expect(ownsCreate()).toBe(false)
  })

  it('does not report a create error into a superseding route', () => {
    const setCreateError = vi.fn()
    const showToast = vi.fn()

    reportCaughtError(new Error('old route failed'), 'browser', () => false, [
      setCreateError,
      showToast
    ])

    expect(setCreateError).not.toHaveBeenCalled()
    expect(showToast).not.toHaveBeenCalled()
  })
})
