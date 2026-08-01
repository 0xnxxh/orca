import { useEffect } from 'react'
import {
  clearPendingMobileTasksNavigation,
  getPendingMobileTasksNavigation,
  mobileTasksRouteForMountedHost,
  type MobileTasksRoute
} from './mobile-task-navigation'

type MobileTasksReplaceRouter = {
  replace: (route: MobileTasksRoute) => void
}

export function useMobileTaskHostNavigation(
  router: MobileTasksReplaceRouter,
  hostId: string | undefined
): void {
  // Why: this host-layout effect runs after HostStack's children commit, when nested replace is valid.
  useEffect(() => {
    const intent = getPendingMobileTasksNavigation()
    if (!intent) {
      return
    }
    try {
      const route = mobileTasksRouteForMountedHost(hostId, intent)
      if (route) {
        router.replace(route)
      }
    } finally {
      clearPendingMobileTasksNavigation(intent)
    }
  }, [hostId, router])
}
