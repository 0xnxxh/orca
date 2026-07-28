import { useCallback, useEffect, type MutableRefObject, type RefObject } from 'react'
import { AppState } from 'react-native'
import { consumeRecentMobileWebUserGesture } from './mobile-web-user-gesture'

type MobileWebAppForegroundAuthority = {
  updateAppForegroundState(foreground: boolean): void
}

export function useMobileWebUserGestureAuthority(
  occurredAtRef: MutableRefObject<number | null>,
  foregroundAuthorityRef: RefObject<MobileWebAppForegroundAuthority | null>
): () => boolean {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      foregroundAuthorityRef.current?.updateAppForegroundState(nextState === 'active')
      if (nextState !== 'active') {
        occurredAtRef.current = null
      }
    })
    return () => subscription.remove()
  }, [foregroundAuthorityRef, occurredAtRef])

  return useCallback(() => {
    const occurredAt = occurredAtRef.current
    occurredAtRef.current = null
    return consumeRecentMobileWebUserGesture({
      appState: AppState.currentState,
      occurredAt,
      now: Date.now()
    })
  }, [occurredAtRef])
}
