import type { TaskProvider } from '../tasks/mobile-task-providers'
import {
  MOBILE_WEB_NAVIGATION_INTENTS,
  type MobileWebNavigationIntentTarget
} from './mobile-web-navigation-intent-buffer'

type MobileHomeRouter = {
  push(target: string): void
}

export const MOBILE_WEB_DEFAULT_ENTRY_ENABLED =
  process.env.EXPO_PUBLIC_ORCA_MOBILE_WEB_DEFAULT === '1'

export function navigateFromMobileHome(args: {
  router: MobileHomeRouter
  hostId: string
  target: MobileWebNavigationIntentTarget
  mobileWebDefault?: boolean
}): void {
  if (args.mobileWebDefault ?? MOBILE_WEB_DEFAULT_ENTRY_ENABLED) {
    MOBILE_WEB_NAVIGATION_INTENTS.publishHostTarget(args.hostId, args.target)
    args.router.push('/hybrid')
    return
  }
  args.router.push(nativeMobileHomeTarget(args.hostId, args.target))
}

export function mobileHostWorkspaceEntry(
  hostId: string,
  mobileWebDefault = MOBILE_WEB_DEFAULT_ENTRY_ENABLED
): `/h/${string}` | `/hybrid?hostId=${string}` {
  return mobileWebDefault ? `/hybrid?hostId=${encodeURIComponent(hostId)}` : `/h/${hostId}`
}

function nativeMobileHomeTarget(hostId: string, target: MobileWebNavigationIntentTarget): string {
  if (target.kind === 'session') {
    return `/h/${hostId}/session/${encodeURIComponent(target.hostWorkspaceId)}`
  }
  if (target.kind === 'tasks') {
    return `/h/${hostId}/tasks${taskProviderQuery(target.taskSource)}`
  }
  if (target.kind === 'accounts') {
    return `/h/${hostId}/accounts`
  }
  if (target.kind === 'newWorkspace') {
    return `/h/${hostId}?action=newWorktree`
  }
  return `/h/${hostId}`
}

function taskProviderQuery(provider: TaskProvider | undefined): string {
  return provider ? `?taskSource=${provider}` : ''
}
