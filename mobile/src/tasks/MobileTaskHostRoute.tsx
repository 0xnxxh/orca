import type { ComponentType } from 'react'
import { Redirect, useLocalSearchParams } from 'expo-router'
import { useResponsiveLayout } from '../layout/responsive-layout'
import { WorkspaceDetailPlaceholder } from '../components/WorkspaceDetailPlaceholder'
import { mobileTasksRouteFromHostAction } from './mobile-task-navigation'

export function MobileTaskHostRoute({ hostScreen: HostScreen }: { hostScreen: ComponentType }) {
  const params = useLocalSearchParams<{
    hostId?: string
    action?: string
    taskSource?: string
  }>()
  const { isWideLayout } = useResponsiveLayout()
  const tasksRoute = mobileTasksRouteFromHostAction(params.hostId, params.action, params.taskSource)

  if (tasksRoute) {
    return <Redirect href={tasksRoute} />
  }
  return isWideLayout ? <WorkspaceDetailPlaceholder /> : <HostScreen />
}
