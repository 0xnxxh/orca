import type { TaskProvider } from './mobile-task-providers'

export type MobileTasksRoute =
  | `/h/${string}/tasks`
  | `/h/${string}/tasks?taskSource=${TaskProvider}`

type MobileTasksRouter = {
  push: (href: `/h/${string}`) => void
  replace: (href: MobileTasksRoute) => void
}

export function mobileTasksRoute(hostId: string, provider?: TaskProvider): MobileTasksRoute {
  // Why: Expo Router can drop hostId from dynamic route objects in this cold nested stack.
  const pathname = `/h/${encodeURIComponent(hostId)}/tasks` as const
  return provider ? `${pathname}?taskSource=${provider}` : pathname
}

export function navigateToMobileTasks(
  router: MobileTasksRouter,
  hostId: string,
  provider?: TaskProvider
): void {
  // Why: a cold nested host navigator resolves a deep push to its index route.
  router.push(`/h/${encodeURIComponent(hostId)}`)
  requestAnimationFrame(() => {
    router.replace(mobileTasksRoute(hostId, provider))
  })
}
