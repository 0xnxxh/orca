import {
  MOBILE_WEB_NAVIGATION_INTENTS,
  type MobileWebNavigationIntentTarget
} from './mobile-web-navigation-intent-buffer'

type MobileHomeRouter = {
  push(target: string): void
}

export function navigateFromMobileHome(args: {
  router: MobileHomeRouter
  hostId: string
  target: MobileWebNavigationIntentTarget
}): void {
  MOBILE_WEB_NAVIGATION_INTENTS.publishHostTarget(args.hostId, args.target)
  args.router.push('/hybrid')
}

export function mobileHostWorkspaceEntry(hostId: string): `/hybrid?hostId=${string}` {
  return `/hybrid?hostId=${encodeURIComponent(hostId)}`
}
