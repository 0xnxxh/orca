import { Platform } from 'react-native'

// Why: one source for the native store listing so every update surface (hard
// protocol block screen, soft update nudge) points at the same app.
export const IOS_APP_STORE_URL = 'itms-apps://apps.apple.com/app/orca-ide/id6766130217'

// Why: null on platforms without a known store listing yet; callers hide
// their update button and fall back to text-only messaging.
export function getMobileAppStoreUrl(): string | null {
  return Platform.OS === 'ios' ? IOS_APP_STORE_URL : null
}
