export const MACOS_RELEASE_APP_BUNDLE_ID = 'com.stablyai.orca'
export const MACOS_LOCAL_APP_BUNDLE_ID = 'com.stablyai.orca.local'

export function resolveMacosPackageBundleIdentifiers(env = process.env) {
  const appBundleId =
    env.ORCA_MAC_RELEASE === '1' ? MACOS_RELEASE_APP_BUNDLE_ID : MACOS_LOCAL_APP_BUNDLE_ID
  return {
    appBundleId,
    computerUseBundleId: `${appBundleId}.computer-use`
  }
}
