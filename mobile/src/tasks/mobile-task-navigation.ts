import type { TaskProvider } from './mobile-task-providers'

export type MobileTasksRoute =
  | `/h/${string}/tasks`
  | `/h/${string}/tasks?taskSource=${TaskProvider}`

export type MobileTasksHostRoute = `/h/${string}`

export type MobileTasksNavigationIntent = Readonly<{
  hostId: string
  route: MobileTasksRoute
}>

type MobileTasksRouter = {
  push: (href: MobileTasksHostRoute) => void
}

// Why: cold Expo host stacks drop URL params; the mounted index consumes this bounded intent.
let pendingMobileTasksNavigation: MobileTasksNavigationIntent | null = null

export function mobileTasksRoute(hostId: string, provider?: TaskProvider): MobileTasksRoute {
  // Why: Expo Router can drop hostId from dynamic route objects in this cold nested stack.
  const pathname = `/h/${encodeURIComponent(hostId)}/tasks` as const
  return provider ? `${pathname}?taskSource=${provider}` : pathname
}

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

export function mobileTasksRouteForMountedHost(
  mountedHostId: string | undefined,
  intent: MobileTasksNavigationIntent | null
): MobileTasksRoute | null {
  if (!intent || (mountedHostId && mountedHostId !== intent.hostId)) {
    return null
  }
  return intent.route
}

export function navigateToMobileTasks(
  router: MobileTasksRouter,
  hostId: string,
  provider?: TaskProvider
): void {
  const intent: MobileTasksNavigationIntent = {
    hostId,
    route: mobileTasksRoute(hostId, provider)
  }
  pendingMobileTasksNavigation = intent
  try {
    router.push(mobileTasksHostRoute(hostId))
  } catch (error) {
    clearPendingMobileTasksNavigation(intent)
    throw error
  }
}
