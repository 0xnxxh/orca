import { useCallback } from 'react'
import { useRouter } from 'expo-router'
import { MOBILE_WEB_NAVIGATION_INTENTS } from '../mobile-web/mobile-web-navigation-intent-buffer'
import type { NotificationNavigationTarget } from './notification-routing'

export function useOpenNotificationRoute(): (target: NotificationNavigationTarget) => void {
  const router = useRouter()

  return useCallback(
    (target) => {
      MOBILE_WEB_NAVIGATION_INTENTS.publish(target)
      router.push('/hybrid')
    },
    [router]
  )
}
