const { execFileSync } = require('node:child_process')
const { existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

// Why: macOS shows a consent dialog only when the requesting bundle declares a
// usage description for the service. The detached PTY daemon keeps running
// inside the Electron helper bundle after the main app quits, so the helper is
// the effective requesting app and needs the same strings as the main app —
// otherwise TCC denies with a silent EPERM and no dialog (#9756).
const macPrivacyUsageDescriptions = {
  NSAppDataUsageDescription:
    "Orca allows terminal-launched developer tools to access other apps' data when you request it.",
  NSAppleEventsUsageDescription:
    'Orca allows terminal-launched developer tools to automate local apps when you request it.',
  NSBluetoothAlwaysUsageDescription:
    'Orca allows terminal-launched developer tools to access Bluetooth devices when you request it.',
  NSBluetoothPeripheralUsageDescription:
    'Orca allows terminal-launched developer tools to access Bluetooth devices when you request it.',
  NSCameraUsageDescription: "Application requests access to the device's camera.",
  NSLocationUsageDescription:
    'Orca allows terminal-launched developer tools to access location when you request it.',
  NSLocalNetworkUsageDescription:
    'Orca allows terminal-launched developer tools to discover and connect to local development servers when you request it.',
  NSMicrophoneUsageDescription: "Application requests access to the device's microphone.",
  NSAudioCaptureUsageDescription:
    'Orca allows terminal-launched developer tools to capture desktop audio when you request it.',
  NSDocumentsFolderUsageDescription: "Application requests access to the user's Documents folder.",
  NSDownloadsFolderUsageDescription: "Application requests access to the user's Downloads folder."
}

function extendMacHelperBundleInfoPlists(appPath) {
  const frameworksDir = join(appPath, 'Contents', 'Frameworks')
  const helperPlistPaths = existsSync(frameworksDir)
    ? readdirSync(frameworksDir)
        .filter((entry) => entry.includes(' Helper') && entry.endsWith('.app'))
        .map((entry) => join(frameworksDir, entry, 'Contents', 'Info.plist'))
        .filter((plistPath) => existsSync(plistPath))
    : []
  if (helperPlistPaths.length === 0) {
    // Why: a darwin package always nests Electron helper apps; an empty match
    // means a layout drift that would silently drop the TCC strings again.
    throw new Error(`No Electron helper app Info.plist found under ${frameworksDir}`)
  }
  for (const plistPath of helperPlistPaths) {
    for (const [key, value] of Object.entries(macPrivacyUsageDescriptions)) {
      // Why: plutil -replace inserts the key when absent, so this is a merge.
      execFileSync('plutil', ['-replace', key, '-string', value, plistPath])
    }
  }
  return helperPlistPaths
}

module.exports = {
  macPrivacyUsageDescriptions,
  extendMacHelperBundleInfoPlists
}
