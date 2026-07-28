import type { MobileWebResumeRoute } from '../../../src/shared/mobile-web/bridge-contract'

export function mobileWebResumeRouteTarget(
  route: MobileWebResumeRoute,
  hostedHostId: string
): string | null {
  if (route.kind === 'workspaceList') {
    return null
  }
  const query = new URLSearchParams({ name: route.workspaceName }).toString()
  return `/h/${encodeURIComponent(hostedHostId)}/session/${encodeURIComponent(route.workspaceId)}?${query}`
}
