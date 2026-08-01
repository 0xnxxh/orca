import type { TaskProvider } from './mobile-task-providers'

export type MobileTasksHostRoute = `/h/${string}`

export type MobileTasksNavigationState = Readonly<{
  key?: string
  index: number
  routes: readonly MobileTasksNavigationRoute[]
}>

export type MobileTasksNavigationRoute = Readonly<{
  key?: string
  name: string
  params?: Readonly<{ hostId?: unknown }>
  state?: MobileTasksNavigationState
}>

export type MobileTasksRootNavigation = {
  addListener: (event: 'state' | 'transitionEnd', listener: () => void) => () => void
  dispatch: (action: MobileTasksHostReplaceAction) => void
  getState: () => MobileTasksNavigationState
}

export type MobileTasksHostReplaceAction = Readonly<{
  type: 'REPLACE'
  target: string
  source: string
  payload: Readonly<{
    name: '[hostId]/tasks'
    params: Readonly<{ hostId: string; taskSource?: TaskProvider }>
  }>
}>

export type MobileTasksRouter = {
  push: (route: MobileTasksHostRoute) => void
}

export type MobileTasksNavigationController = Readonly<{
  cancel: () => void
  isActive: () => boolean
  selectProvider: (provider?: TaskProvider) => void
}>

export type PendingMobileTasksNavigation = Readonly<{
  hostId: string
  controller: MobileTasksNavigationController
}>

export function mobileTasksHostRoute(hostId: string): MobileTasksHostRoute {
  return `/h/${encodeURIComponent(hostId)}`
}

function mountedHostStack(
  state: MobileTasksNavigationState,
  expectedHostId: string
): { key: string; routeKey: string } | null {
  const hostContainer = state.routes[state.index]
  const hostState = hostContainer?.state
  const hostRoute = hostState?.routes[hostState.index]
  if (
    hostContainer?.name !== 'h' ||
    !hostState?.key ||
    hostRoute?.name !== '[hostId]/index' ||
    !hostRoute.key ||
    hostRoute.params?.hostId !== expectedHostId
  ) {
    return null
  }
  return { key: hostState.key, routeKey: hostRoute.key }
}

function activeHostId(state: MobileTasksNavigationState): string | undefined {
  const hostContainer = state.routes[state.index]
  if (hostContainer?.name !== 'h') {
    return undefined
  }
  if (typeof hostContainer.params?.hostId === 'string') {
    return hostContainer.params.hostId
  }
  const hostState = hostContainer.state
  const hostRoute = hostState?.routes[hostState.index]
  return typeof hostRoute?.params?.hostId === 'string' ? hostRoute.params.hostId : undefined
}

export function navigateToMobileTasks(
  navigation: MobileTasksRootNavigation,
  router: MobileTasksRouter,
  hostId: string,
  provider?: TaskProvider
): MobileTasksNavigationController {
  let active = true
  let selectedProvider = provider
  let unsubscribeState = () => {}
  let unsubscribeTransition = () => {}
  const dispose = () => {
    if (!active) {
      return
    }
    active = false
    unsubscribeState()
    unsubscribeTransition()
  }

  // Why: cold Expo deep links resolve to index; target Tasks only after its HostStack exists.
  const onState = () => {
    if (!active) {
      return
    }
    const state = navigation.getState()
    const hostStack = mountedHostStack(state, hostId)
    if (!hostStack) {
      return
    }
    dispose()
    const action: MobileTasksHostReplaceAction = {
      type: 'REPLACE',
      target: hostStack.key,
      source: hostStack.routeKey,
      payload: {
        name: '[hostId]/tasks',
        params: selectedProvider ? { hostId, taskSource: selectedProvider } : { hostId }
      }
    }
    navigation.dispatch(action)
  }

  try {
    unsubscribeState = navigation.addListener('state', onState)
    unsubscribeTransition = navigation.addListener('transitionEnd', () => {
      if (activeHostId(navigation.getState()) === hostId) {
        dispose()
      }
    })
    router.push(mobileTasksHostRoute(hostId))
  } catch (error) {
    dispose()
    throw error
  }
  return {
    cancel: dispose,
    isActive: () => active,
    selectProvider: (nextProvider) => {
      if (active) {
        selectedProvider = nextProvider
      }
    }
  }
}

export function coordinateMobileTasksNavigation(
  current: PendingMobileTasksNavigation | null,
  navigation: MobileTasksRootNavigation,
  router: MobileTasksRouter,
  hostId: string,
  provider?: TaskProvider
): PendingMobileTasksNavigation {
  if (current?.hostId === hostId && current.controller.isActive()) {
    current.controller.selectProvider(provider)
    return current
  }
  current?.controller.cancel()
  return {
    hostId,
    controller: navigateToMobileTasks(navigation, router, hostId, provider)
  }
}
