import { shouldPresentNotificationOptIn } from '../notifications/notification-opt-in-gate'
import { shouldPresentSessionViewOptIn } from '../session/session-view-opt-in-gate'

export type MobileOnboardingPrompt = 'notifications' | 'session-view' | null
export type MobileOnboardingDestination =
  | '/'
  | `/h/${string}`
  | '/notification-opt-in'
  | '/session-view-opt-in'
  | {
      pathname: '/notification-opt-in' | '/session-view-opt-in'
      params: { hostId: string }
    }

/** Picks the first outstanding one-time decision. */
export async function selectMobileOnboardingPrompt(): Promise<MobileOnboardingPrompt> {
  // Why: the OS permission decision must finish before the app-level session-view choice;
  // short-circuiting also avoids reading later preferences while a prompt is already due.
  if (await shouldPresentNotificationOptIn()) {
    return 'notifications'
  }
  return (await shouldPresentSessionViewOptIn()) ? 'session-view' : null
}

/** Preserves a paired host while routing through any outstanding decision. */
export function mobileOnboardingDestination(
  prompt: MobileOnboardingPrompt,
  hostId?: string
): MobileOnboardingDestination {
  if (prompt === null) {
    return hostId ? `/h/${hostId}` : '/'
  }
  const pathname = prompt === 'notifications' ? '/notification-opt-in' : '/session-view-opt-in'
  return hostId ? { pathname, params: { hostId } } : pathname
}
