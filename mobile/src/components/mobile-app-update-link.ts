const IOS_APP_STORE_URL = 'itms-apps://apps.apple.com/app/orca-ide/id6766130217'
const ANDROID_RELEASES_URL = 'https://github.com/stablyai/orca/releases'

// Why: Android ships from versioned GitHub releases while iOS ships through
// the App Store; keep both update surfaces aligned with the actual distribution.
export function getMobileAppUpdateUrl(
  platform: string,
  recommendedVersion?: string
): string | null {
  if (platform === 'ios') {
    return IOS_APP_STORE_URL
  }
  if (platform === 'android') {
    return recommendedVersion
      ? `${ANDROID_RELEASES_URL}/tag/mobile-android-v${encodeURIComponent(recommendedVersion)}`
      : ANDROID_RELEASES_URL
  }
  return null
}
