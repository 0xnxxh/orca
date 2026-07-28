import type { NotificationNavigationTarget } from '../notifications/notification-routing'
import type { TaskProvider } from '../tasks/mobile-task-providers'

export type MobileWebNavigationIntentTarget =
  | { kind: 'workspaceList' }
  | { kind: 'session'; hostWorkspaceId: string }
  | { kind: 'tasks'; taskSource?: TaskProvider }
  | { kind: 'accounts' }
  | { kind: 'newWorkspace' }

export type MobileWebNavigationIntent = {
  sequence: number
  source: 'notification' | 'coldResume' | 'home'
  hostId: string
  target: MobileWebNavigationIntentTarget
}

type MobileWebNavigationIntentListener = (intent: MobileWebNavigationIntent) => void

export class MobileWebNavigationIntentBuffer {
  private readonly listeners = new Set<MobileWebNavigationIntentListener>()
  private latest: MobileWebNavigationIntent | null = null
  private nextSequence = 0

  publish(
    target: NotificationNavigationTarget,
    source: 'notification' | 'coldResume' = 'notification'
  ): MobileWebNavigationIntent {
    return this.publishHostTarget(
      target.hostId,
      target.kind === 'session'
        ? { kind: 'session', hostWorkspaceId: target.hostWorkspaceId }
        : { kind: 'workspaceList' },
      source
    )
  }

  publishHostTarget(
    hostId: string,
    target: MobileWebNavigationIntentTarget,
    source: MobileWebNavigationIntent['source'] = 'home'
  ): MobileWebNavigationIntent {
    const intent = { sequence: this.nextSequence, source, hostId, target }
    this.nextSequence += 1
    this.latest = intent
    this.listeners.forEach((listener) => listener(intent))
    return intent
  }

  subscribe(listener: MobileWebNavigationIntentListener): () => void {
    this.listeners.add(listener)
    if (this.latest) {
      listener(this.latest)
    }
    return () => this.listeners.delete(listener)
  }

  hasListener(): boolean {
    return this.listeners.size > 0
  }

  isCurrent(sequence: number): boolean {
    return this.latest?.sequence === sequence
  }

  consume(sequence: number): boolean {
    if (this.latest?.sequence !== sequence) {
      return false
    }
    this.latest = null
    return true
  }
}

export const MOBILE_WEB_NAVIGATION_INTENTS = new MobileWebNavigationIntentBuffer()

export function shouldHandoffNotificationToMobileWeb(
  pathname: string,
  hasIntentListener: boolean,
  mobileWebDefault = false
): boolean {
  return mobileWebDefault || (pathname === '/hybrid' && hasIntentListener)
}
