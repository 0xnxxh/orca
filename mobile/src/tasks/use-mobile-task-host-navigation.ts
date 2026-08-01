import { useEffect } from 'react'
import {
  clearPendingMobileTasksNavigation,
  getPendingMobileTasksNavigation,
  mobileTasksScreenParamsForMountedHost,
  type MobileTasksScreenParams
} from './mobile-task-navigation'

export type MobileTasksHostNavigation = {
  replace: (screen: '[hostId]/tasks', params: MobileTasksScreenParams) => void
}

export function useMobileTaskHostNavigation(
  navigation: MobileTasksHostNavigation,
  hostId: string | undefined
): void {
  // Why: the routed index owns the mounted HostStack navigation context, bypassing cold URL parsing.
  useEffect(() => {
    const intent = getPendingMobileTasksNavigation()
    if (!intent) {
      return
    }
    try {
      const params = mobileTasksScreenParamsForMountedHost(hostId, intent)
      if (params) {
        navigation.replace('[hostId]/tasks', params)
      }
    } finally {
      clearPendingMobileTasksNavigation(intent)
    }
  }, [hostId, navigation])
}
