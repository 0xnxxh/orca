import type { NotificationNavigationTarget } from '../notifications/notification-routing'

export type MobileWebNavigationIntent = {
  sequence: number
  source: 'notification' | 'coldResume'
  hostId: string
  target: { kind: 'workspaceList' } | { kind: 'session'; hostWorkspaceId: string }
}

type MobileWebNavigationIntentListener = (intent: MobileWebNavigationIntent) => void

export class MobileWebNavigationIntentBuffer {
  private readonly listeners = new Set<MobileWebNavigationIntentListener>()
  private latest: MobileWebNavigationIntent | null = null
  private nextSequence = 0

  publish(
    target: NotificationNavigationTarget,
    source: MobileWebNavigationIntent['source'] = 'notification'
  ): MobileWebNavigationIntent {
    const intent: MobileWebNavigationIntent = {
      sequence: this.nextSequence,
      source,
      hostId: target.hostId,
      target:
        target.kind === 'session'
          ? { kind: 'session', hostWorkspaceId: target.hostWorkspaceId }
          : { kind: 'workspaceList' }
    }
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
  hasIntentListener: boolean
): boolean {
  return pathname === '/hybrid' && hasIntentListener
}
