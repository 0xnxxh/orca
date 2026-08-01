import type { TaskProvider } from './mobile-task-providers'

export type MobileTasksRoute =
  | `/h/${string}/tasks`
  | `/h/${string}/tasks?taskSource=${TaskProvider}`

export type MobileTasksHostRoute =
  | `/h/${string}?action=tasks`
  | `/h/${string}?action=tasks&taskSource=${TaskProvider}`

type MobileTasksRouter = {
  push: (href: MobileTasksHostRoute) => void
}

export function mobileTasksRoute(hostId: string, provider?: TaskProvider): MobileTasksRoute {
  // Why: Expo Router can drop hostId from dynamic route objects in this cold nested stack.
  const pathname = `/h/${encodeURIComponent(hostId)}/tasks` as const
  return provider ? `${pathname}?taskSource=${provider}` : pathname
}

export function mobileTasksHostRoute(
  hostId: string,
  provider?: TaskProvider
): MobileTasksHostRoute {
  const pathname = `/h/${encodeURIComponent(hostId)}?action=tasks` as const
  return provider ? `${pathname}&taskSource=${provider}` : pathname
}

export function mobileTasksRouteFromHostAction(
  hostId: string | undefined,
  action: string | undefined,
  taskSource: string | undefined
): MobileTasksRoute | null {
  if (!hostId || action !== 'tasks') {
    return null
  }
  const provider =
    taskSource === 'github' || taskSource === 'gitlab' || taskSource === 'linear'
      ? taskSource
      : undefined
  return mobileTasksRoute(hostId, provider)
}

export function navigateToMobileTasks(
  router: MobileTasksRouter,
  hostId: string,
  provider?: TaskProvider
): void {
  router.push(mobileTasksHostRoute(hostId, provider))
}
