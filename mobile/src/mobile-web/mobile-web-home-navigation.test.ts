import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileWebNavigationIntent } from './mobile-web-navigation-intent-buffer'
import { MOBILE_WEB_NAVIGATION_INTENTS } from './mobile-web-navigation-intent-buffer'
import { mobileHostWorkspaceEntry, navigateFromMobileHome } from './mobile-web-home-navigation'

let latestIntent: MobileWebNavigationIntent | null = null
const unsubscribe = MOBILE_WEB_NAVIGATION_INTENTS.subscribe((intent) => {
  latestIntent = intent
})

afterEach(() => {
  if (latestIntent) {
    MOBILE_WEB_NAVIGATION_INTENTS.consume(latestIntent.sequence)
  }
  latestIntent = null
})

describe('mobile web Home navigation', () => {
  it.each([
    [{ kind: 'workspaceList' } as const, '/h/host'],
    [
      { kind: 'session', hostWorkspaceId: 'repo::/work tree' } as const,
      '/h/host/session/repo%3A%3A%2Fwork%20tree'
    ],
    [{ kind: 'tasks', taskSource: 'gitlab' } as const, '/h/host/tasks?taskSource=gitlab'],
    [{ kind: 'accounts' } as const, '/h/host/accounts'],
    [{ kind: 'newWorkspace' } as const, '/h/host?action=newWorktree']
  ])('retains the native fallback for %s', (target, expected) => {
    const router = { push: vi.fn() }

    navigateFromMobileHome({ router, hostId: 'host', target, mobileWebDefault: false })

    expect(router.push).toHaveBeenCalledWith(expected)
    expect(latestIntent).toBeNull()
  })

  it('hands a typed destination to the hosted route without changing Home UI', () => {
    const router = { push: vi.fn() }

    navigateFromMobileHome({
      router,
      hostId: 'host',
      target: { kind: 'tasks', taskSource: 'linear' },
      mobileWebDefault: true
    })

    expect(router.push).toHaveBeenCalledWith('/hybrid')
    expect(latestIntent).toMatchObject({
      source: 'home',
      hostId: 'host',
      target: { kind: 'tasks', taskSource: 'linear' }
    })
  })

  it('switches post-pairing host entry and encodes the hosted route identity', () => {
    expect(mobileHostWorkspaceEntry('host', false)).toBe('/h/host')
    expect(mobileHostWorkspaceEntry('host/key?', true)).toBe('/hybrid?hostId=host%2Fkey%3F')
  })
})

afterAll(() => unsubscribe())
