import { useEffect, type ComponentType } from 'react'
import { Redirect, useLocalSearchParams } from 'expo-router'
import { useResponsiveLayout } from '../layout/responsive-layout'
import { WorkspaceDetailPlaceholder } from '../components/WorkspaceDetailPlaceholder'
import {
  clearPendingMobileTasksNavigation,
  getPendingMobileTasksNavigation,
  mobileTasksRouteForMountedHost
} from './mobile-task-navigation'

export function MobileTaskHostRoute({ hostScreen: HostScreen }: { hostScreen: ComponentType }) {
  const params = useLocalSearchParams<{ hostId?: string }>()
  const { isWideLayout } = useResponsiveLayout()
  const intent = getPendingMobileTasksNavigation()
  const tasksRoute = mobileTasksRouteForMountedHost(params.hostId, intent)

  // Why: unmount proves the redirect committed; identity cleanup cannot erase a newer tap.
  useEffect(() => {
    if (!intent) {
      return
    }
    if (!tasksRoute) {
      clearPendingMobileTasksNavigation(intent)
      return
    }
    return () => clearPendingMobileTasksNavigation(intent)
  }, [intent, tasksRoute])

  if (tasksRoute) {
    return <Redirect href={tasksRoute} />
  }
  return isWideLayout ? <WorkspaceDetailPlaceholder /> : <HostScreen />
}
