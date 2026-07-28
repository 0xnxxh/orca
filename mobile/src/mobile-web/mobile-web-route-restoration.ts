import type {
  MobileWebNavigationRoute,
  MobileWebResumeRoute
} from '../../../src/shared/mobile-web/bridge-contract'

export function mobileWebResumeRouteTarget(
  route: MobileWebResumeRoute,
  hostedHostId: string
): string | null {
  const target = mobileWebNavigationRouteTarget(route, hostedHostId)
  return target === '/' ? null : target
}

export function mobileWebNavigationRouteTarget(
  route: MobileWebNavigationRoute,
  hostedHostId: string
): string {
  if (route.kind === 'workspaceList') {
    return '/'
  }
  if (route.kind === 'tasks') {
    const query = route.taskSource
      ? `?${new URLSearchParams({ taskSource: route.taskSource }).toString()}`
      : ''
    return `/h/${encodeURIComponent(hostedHostId)}/tasks${query}`
  }
  if (route.kind === 'accounts') {
    return `/h/${encodeURIComponent(hostedHostId)}/accounts`
  }
  if (route.kind === 'newWorkspace') {
    return '/?action=newWorktree'
  }
  const query = new URLSearchParams({ name: route.workspaceName }).toString()
  return `/h/${encodeURIComponent(hostedHostId)}/session/${encodeURIComponent(route.workspaceId)}?${query}`
}
