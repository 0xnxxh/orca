import type { TaskProvider } from './mobile-task-providers'

export type MobileTasksHostRoute = `/h/${string}`

export type MobileTasksScreenParams = Readonly<{
  hostId: string
  taskSource?: TaskProvider
}>

export type MobileTasksNavigationIntent = MobileTasksScreenParams

type MobileTasksRouter = {
  push: (href: MobileTasksHostRoute) => void
}

// Why: cold Expo host stacks drop URL params; the mounted index consumes this bounded intent.
let pendingMobileTasksNavigation: MobileTasksNavigationIntent | null = null

export function mobileTasksHostRoute(hostId: string): MobileTasksHostRoute {
  return `/h/${encodeURIComponent(hostId)}`
}

export function getPendingMobileTasksNavigation(): MobileTasksNavigationIntent | null {
  return pendingMobileTasksNavigation
}

export function clearPendingMobileTasksNavigation(intent: MobileTasksNavigationIntent): void {
  if (pendingMobileTasksNavigation === intent) {
    pendingMobileTasksNavigation = null
  }
}

export function mobileTasksScreenParamsForMountedHost(
  mountedHostId: string | undefined,
  intent: MobileTasksNavigationIntent | null
): MobileTasksScreenParams | null {
  if (!intent || (mountedHostId && mountedHostId !== intent.hostId)) {
    return null
  }
  return intent
}

export function navigateToMobileTasks(
  router: MobileTasksRouter,
  hostId: string,
  provider?: TaskProvider
): void {
  const intent: MobileTasksNavigationIntent = provider
    ? { hostId, taskSource: provider }
    : { hostId }
  pendingMobileTasksNavigation = intent
  try {
    router.push(mobileTasksHostRoute(hostId))
  } catch (error) {
    clearPendingMobileTasksNavigation(intent)
    throw error
  }
}
