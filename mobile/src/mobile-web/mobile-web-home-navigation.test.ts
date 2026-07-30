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
  it('hands a typed destination to the production hosted route', () => {
    const router = { push: vi.fn() }

    navigateFromMobileHome({
      router,
      hostId: 'host',
      target: { kind: 'tasks', taskSource: 'linear' }
    })

    expect(router.push).toHaveBeenCalledWith('/hybrid')
    expect(latestIntent).toMatchObject({
      source: 'home',
      hostId: 'host',
      target: { kind: 'tasks', taskSource: 'linear' }
    })
  })

  it('encodes the post-pairing hosted route identity', () => {
    expect(mobileHostWorkspaceEntry('host/key?')).toBe('/hybrid?hostId=host%2Fkey%3F')
  })
})

afterAll(() => unsubscribe())
