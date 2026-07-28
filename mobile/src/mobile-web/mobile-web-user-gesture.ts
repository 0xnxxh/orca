import type { AppStateStatus } from 'react-native'

export const MOBILE_WEB_USER_GESTURE_MAX_AGE_MS = 5_000

export function consumeRecentMobileWebUserGesture(args: {
  appState: AppStateStatus
  occurredAt: number | null
  now: number
}): boolean {
  if (args.appState !== 'active' || args.occurredAt === null) {
    return false
  }
  const age = args.now - args.occurredAt
  return age >= 0 && age <= MOBILE_WEB_USER_GESTURE_MAX_AGE_MS
}
