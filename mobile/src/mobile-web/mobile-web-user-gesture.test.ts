import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  consumeRecentMobileWebUserGesture,
  MOBILE_WEB_USER_GESTURE_MAX_AGE_MS
} from './mobile-web-user-gesture'

describe('mobile web user gesture', () => {
  it('accepts only a recent native-observed touch', () => {
    expect(
      consumeRecentMobileWebUserGesture({
        appState: 'active',
        occurredAt: 1_000,
        now: 1_001
      })
    ).toBe(true)
    expect(
      consumeRecentMobileWebUserGesture({
        appState: 'active',
        occurredAt: 1_000,
        now: 1_000 + MOBILE_WEB_USER_GESTURE_MAX_AGE_MS
      })
    ).toBe(true)
    expect(
      consumeRecentMobileWebUserGesture({
        appState: 'active',
        occurredAt: 1_000,
        now: 1_001 + MOBILE_WEB_USER_GESTURE_MAX_AGE_MS
      })
    ).toBe(false)
  })

  it('rejects missing and future touches', () => {
    expect(
      consumeRecentMobileWebUserGesture({
        appState: 'active',
        occurredAt: null,
        now: 1_000
      })
    ).toBe(false)
    expect(
      consumeRecentMobileWebUserGesture({
        appState: 'active',
        occurredAt: 1_001,
        now: 1_000
      })
    ).toBe(false)
  })

  it.each(['background', 'inactive', 'unknown', 'extension'] as const)(
    'rejects a recent touch while the native app is %s',
    (appState) => {
      expect(
        consumeRecentMobileWebUserGesture({
          appState,
          occurredAt: 1_000,
          now: 1_001
        })
      ).toBe(false)
    }
  )

  it('revokes the shell gesture when native lifecycle leaves foreground', () => {
    const authoritySource = readFileSync(
      new URL('./use-mobile-web-user-gesture-authority.ts', import.meta.url),
      'utf8'
    )

    expect(authoritySource).toContain("AppState.addEventListener('change'")
    expect(authoritySource).toContain("if (nextState !== 'active')")
    expect(authoritySource).toContain('occurredAtRef.current = null')
    expect(authoritySource).toContain('appState: AppState.currentState')
    expect(authoritySource).toContain(
      "foregroundAuthorityRef.current?.updateAppForegroundState(nextState === 'active')"
    )
  })
})
